import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { isPrivateDataDeleted } from './privateDeletion';
import { resolveUserIdByAuthId, validateOwnership } from './helpers';
import {
  CURRENT_PHASE2_SETUP_VERSION,
  PHASE2_BOUNDARY_KEYS,
  PHASE2_DESIRE_TAG_KEYS,
  PHASE2_INTENT_KEYS,
} from './phase2Constants';

const DEBUG_PHASE2_BACKEND = process.env.DEBUG_PHASE2 === "true";

const PHASE2_PRIVATE_BIO_MIN_LENGTH = 20;
const PHASE2_PRIVATE_BIO_MAX_LENGTH = 300;

// Phase-2 nickname (displayName) validation — kept in sync with
// `lib/phase2Onboarding.ts > validateNickname`. Convex source files cannot
// import from the app code path, so the rules are mirrored here. If you change
// either side, update the other.
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
const PHASE2_PROMPT_ANSWER_MIN_LENGTH = 5;
const PHASE2_PROMPT_ANSWER_MAX_LENGTH = 250;
const PHASE2_MAX_PROMPTS = 10;
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
  // Canonical source of truth: users.dateOfBirth (Phase-1)
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

function sanitizePromptAnswers(
  promptAnswers:
    | Array<{ promptId: string; question: string; answer: string }>
    | undefined,
):
  | { ok: true; value?: Array<{ promptId: string; question: string; answer: string }> }
  | { ok: false; error: string } {
  if (promptAnswers === undefined) {
    return { ok: true };
  }

  if (promptAnswers.length > PHASE2_MAX_PROMPTS) {
    return {
      ok: false,
      error: `promptAnswers must contain ${PHASE2_MAX_PROMPTS} or fewer items`,
    };
  }

  const trimmed = promptAnswers.map((prompt) => ({
    ...prompt,
    question: prompt.question.trim(),
    answer: prompt.answer.trim(),
  }));

  // Defensive dedupe by promptId — keep the LAST entry for each promptId so
  // bulk writes that accidentally re-include a stale row don't end up rendering
  // the same prompt twice. Empty promptIds are kept as-is.
  const seenIds = new Set<string>();
  const sanitized: typeof trimmed = [];
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const prompt = trimmed[i];
    if (prompt.promptId) {
      if (seenIds.has(prompt.promptId)) continue;
      seenIds.add(prompt.promptId);
    }
    sanitized.unshift(prompt);
  }

  for (const prompt of sanitized) {
    if (
      prompt.answer.length < PHASE2_PROMPT_ANSWER_MIN_LENGTH ||
      prompt.answer.length > PHASE2_PROMPT_ANSWER_MAX_LENGTH
    ) {
      return {
        ok: false,
        error: `promptAnswers answers must be ${PHASE2_PROMPT_ANSWER_MIN_LENGTH}-${PHASE2_PROMPT_ANSWER_MAX_LENGTH} characters`,
      };
    }
  }

  return { ok: true, value: sanitized };
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

const PHASE2_NOTIFICATION_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const PHASE2_NOTIFICATION_RATE_LIMIT_MAX_WRITES = 20;

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

export const debugAgeSourcesByAuthUserId = query({
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

export const backfillPrivateProfileAgeByAuthUserId = mutation({
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

// Get private profile by user ID
export const getByUserId = query({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, args.userId);
    if (isDeleted) {
      return null; // Return null if data is pending deletion
    }

    const profile = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .first();
    return profile;
  },
});

// Create or update private profile
// NOTE: hobbies and isVerified are imported from Phase-1 during setup and stored here for isolation
export const upsert = mutation({
  args: {
    userId: v.id('users'),
    isPrivateEnabled: v.boolean(),
    ageConfirmed18Plus: v.boolean(),
    ageConfirmedAt: v.optional(v.number()),
    privatePhotosBlurred: v.array(v.id('_storage')),
    privatePhotoUrls: v.array(v.string()),
    privatePhotoBlurLevel: v.optional(v.number()),
    privateIntentKeys: v.array(v.string()),
    privateIntentKey: v.optional(v.union(v.string(), v.null())),
    privateDesireTagKeys: v.array(v.string()),
    privateBoundaries: v.array(v.string()),
    privateBio: v.optional(v.string()),
    displayName: v.string(),
    age: v.number(),
    city: v.optional(v.string()),
    gender: v.string(),
    revealPolicy: v.optional(v.union(v.literal('mutual_only'), v.literal('request_based'))),
    isSetupComplete: v.boolean(),
    // Phase-1 imported fields (stored in Phase-2 for isolation)
    hobbies: v.optional(v.array(v.string())),
    isVerified: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // C9 FIX: Require authentication and verify ownership (pattern: truthDare.ts:1424-1426)
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized: authentication required');
    }
    if (args.userId !== identity.subject) {
      throw new Error('Unauthorized: cannot modify another user profile');
    }

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, args.userId);
    if (isDeleted) {
      throw new Error('Cannot update profile while deletion is pending');
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .first();

    const now = Date.now();
    const privateIntentKeys = sanitizePrivateIntentKeysForSave(
      args.privateIntentKeys,
      args.privateIntentKey,
    ) ?? [];
    const privateDesireTagKeys = sanitizePrivateDesireTagKeysForSave(
      args.privateDesireTagKeys,
    ) ?? [];
    const { privateIntentKey: _legacyPrivateIntentKey, ...profileArgs } = args;

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...profileArgs,
        privateIntentKeys,
        privateDesireTagKeys,
        updatedAt: now,
      });
      return { success: true, profileId: existing._id };
    }

    const profileId = await ctx.db.insert('userPrivateProfiles', {
      ...profileArgs,
      privateIntentKeys,
      privateDesireTagKeys,
      createdAt: now,
      updatedAt: now,
    });
    return { success: true, profileId };
  },
});

// Update specific fields on private profile
export const updateFields = mutation({
  args: {
    userId: v.id('users'),
    isPrivateEnabled: v.optional(v.boolean()),
    privateIntentKeys: v.optional(v.array(v.string())),
    privateIntentKey: v.optional(v.union(v.string(), v.null())),
    privateDesireTagKeys: v.optional(v.array(v.string())),
    privateBoundaries: v.optional(v.array(v.string())),
    privateBio: v.optional(v.string()),
    revealPolicy: v.optional(v.union(v.literal('mutual_only'), v.literal('request_based'))),
    isSetupComplete: v.optional(v.boolean()),
    // Profile details
    height: v.optional(v.union(v.number(), v.null())),
    weight: v.optional(v.union(v.number(), v.null())),
    smoking: v.optional(v.union(v.string(), v.null())),
    drinking: v.optional(v.union(v.string(), v.null())),
    education: v.optional(v.union(v.string(), v.null())),
    religion: v.optional(v.union(v.string(), v.null())),
    // Photos
    privatePhotoUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // BE-001 SECURITY FIX: Require authentication and verify ownership
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized: authentication required');
    }
    if (args.userId !== identity.subject) {
      throw new Error('Unauthorized: cannot modify another user profile');
    }

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, args.userId);
    if (isDeleted) {
      throw new Error('Cannot update profile while deletion is pending');
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .first();

    if (!existing) {
      throw new Error('Private profile not found');
    }

    const privateIntentKeys = sanitizePrivateIntentKeysForSave(
      args.privateIntentKeys,
      args.privateIntentKey,
    );
    const privateDesireTagKeys = sanitizePrivateDesireTagKeysForSave(args.privateDesireTagKeys);
    const { userId, privateIntentKey: _legacyPrivateIntentKey, ...updates } = args;
    // Remove undefined values
    const cleanUpdates: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        cleanUpdates[key] = value;
      }
    }
    if (privateIntentKeys !== undefined) {
      cleanUpdates.privateIntentKeys = privateIntentKeys;
    }
    if (privateDesireTagKeys !== undefined) {
      cleanUpdates.privateDesireTagKeys = privateDesireTagKeys;
    }

    await ctx.db.patch(existing._id, cleanUpdates);
    return { success: true };
  },
});

// Update blurred photos after upload
export const updateBlurredPhotos = mutation({
  args: {
    userId: v.id('users'),
    privatePhotosBlurred: v.array(v.id('_storage')),
    privatePhotoUrls: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // BE-002 SECURITY FIX: Require authentication and verify ownership
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized: authentication required');
    }
    if (args.userId !== identity.subject) {
      throw new Error('Unauthorized: cannot modify another user photos');
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .first();

    if (!existing) {
      throw new Error('Private profile not found');
    }

    await ctx.db.patch(existing._id, {
      privatePhotosBlurred: args.privatePhotosBlurred,
      privatePhotoUrls: args.privatePhotoUrls,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Delete private profile
export const deleteProfile = mutation({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    // BE-003 SECURITY FIX: Require authentication and verify ownership
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized: authentication required');
    }
    if (args.userId !== identity.subject) {
      throw new Error('Unauthorized: cannot delete another user profile');
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .first();

    if (!existing) return { success: true };

    // Delete blurred photos from storage
    for (const storageId of existing.privatePhotosBlurred) {
      try {
        await ctx.storage.delete(storageId);
      } catch {
        // Storage item may already be deleted
      }
    }

    await ctx.db.delete(existing._id);
    return { success: true };
  },
});

/**
 * Update specific fields on private profile by auth user ID.
 * Uses the same auth-safe pattern as upsertByAuthId (no ctx.auth.getUserIdentity).
 * Used by Phase-2 profile for photo sync and field updates.
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

    const promptValidation = sanitizePromptAnswers(args.promptAnswers);
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

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, userId);
    if (isDeleted) {
      console.warn('[PRIVATE_PROFILE] updateFieldsByAuthId: deletion pending');
      return { success: false, error: 'deletion_pending' };
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    if (!existing) {
      console.warn('[PRIVATE_PROFILE] updateFieldsByAuthId: profile not found');
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
    const { authUserId, token, privateIntentKey: _legacyPrivateIntentKey, ...updates } = args;
    const cleanUpdates: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === null) continue;
      cleanUpdates[key] = value;
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
        console.log('[PRIVATE_PROFILE] updateFieldsByAuthId: healed age', {
          previousAge: existing.age,
          fixedAge,
        });
      }
    }

    await ctx.db.patch(existing._id, cleanUpdates);
    console.log('[PRIVATE_PROFILE] updateFieldsByAuthId: success');
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
    const recentWrites = await ctx.db
      .query('userPrivateProfileAuditLog')
      .withIndex('by_user_changedAt', (q) =>
        q.eq('userId', userId).gte('changedAt', now - PHASE2_NOTIFICATION_RATE_LIMIT_WINDOW_MS)
      )
      .take(PHASE2_NOTIFICATION_RATE_LIMIT_MAX_WRITES + 1);

    if (recentWrites.length > PHASE2_NOTIFICATION_RATE_LIMIT_MAX_WRITES) {
      return { success: false as const, error: 'rate_limited' as const };
    }

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
      return { success: false, error: 'profile_not_found' as const };
    }

    const currentCount = (existing as any).displayNameEditCount ?? 0;
    if (currentCount >= 3) {
      return { success: false, error: 'Nickname change limit reached' as const };
    }

    const now = Date.now();
    await ctx.db.patch(existing._id, {
      displayName: trimmed,
      displayNameEditCount: currentCount + 1,
      lastDisplayNameEditedAt: now,
      updatedAt: now,
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

    // Only include lifestyle fields if they have valid values
    const height = (user as any).height;
    const weight = (user as any).weight;
    const smoking = (user as any).smoking;
    const drinking = (user as any).drinking;
    const education = (user as any).education;
    const religion = (user as any).religion;
    const activities = (user as any).activities;

    const appliedFields = {
      height: false,
      weight: false,
      smoking: false,
      drinking: false,
      education: false,
      religion: false,
      hobbies: false,
    };

    if (typeof height === 'number' && height > 0) {
      patch.height = height;
      appliedFields.height = true;
    }
    if (typeof weight === 'number' && weight > 0) {
      patch.weight = weight;
      appliedFields.weight = true;
    }
    if (typeof smoking === 'string' && smoking.length > 0) {
      patch.smoking = smoking;
      appliedFields.smoking = true;
    }
    if (typeof drinking === 'string' && drinking.length > 0) {
      patch.drinking = drinking;
      appliedFields.drinking = true;
    }
    if (typeof education === 'string' && education.length > 0) {
      patch.education = education;
      appliedFields.education = true;
    }
    if (typeof religion === 'string' && religion.length > 0) {
      patch.religion = religion;
      appliedFields.religion = true;
    }
    if (Array.isArray(activities) && activities.length > 0) {
      patch.hobbies = activities;
      appliedFields.hobbies = true;
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
      height: appliedFields.height ? (height as number) : undefined,
      weight: appliedFields.weight ? (weight as number) : undefined,
      smoking: appliedFields.smoking ? (smoking as string) : undefined,
      drinking: appliedFields.drinking ? (drinking as string) : undefined,
      education: appliedFields.education ? (education as string) : undefined,
      religion: appliedFields.religion ? (religion as string) : undefined,
      hobbies: appliedFields.hobbies ? (activities as string[]) : undefined,
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
export const backfillPrivateProfileAges = mutation({
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

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, userId);
    if (isDeleted) {
      console.warn('[PRIVATE_PROFILE] saveOnboardingPhotos: deletion pending');
      return { success: false, error: 'deletion_pending' };
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    const now = Date.now();

    if (existing) {
      // Build patch object starting with photos
      const patch: Record<string, unknown> = {
        privatePhotoUrls: args.privatePhotoUrls,
        phase2SetupVersion: CURRENT_PHASE2_SETUP_VERSION,
        updatedAt: now,
      };

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
          console.log('[PRIVATE_PROFILE] saveOnboardingPhotos: healed age', {
            previousAge: existing.age,
            fixedAge,
          });
        }
      }

      await ctx.db.patch(existing._id, patch);
      console.log('[PRIVATE_PROFILE] saveOnboardingPhotos: updated existing profile');
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
    const profileId = await ctx.db.insert('userPrivateProfiles', {
      userId,
      displayName: trimmedDisplayName || '',
      displayNameEditCount: 0,
      lastDisplayNameEditedAt: now,
      phase2SetupVersion: CURRENT_PHASE2_SETUP_VERSION,
      // Canonical identity field: backend source of truth only
      age: derivedAge,
      gender: user?.gender || '',
      privateBio: '',
      privateIntentKeys: [],
      privatePhotoUrls: args.privatePhotoUrls,
      city: user?.city || '',
      isPrivateEnabled: true,
      ageConfirmed18Plus: true,
      ageConfirmedAt: now,
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
    console.log('[PRIVATE_PROFILE] saveOnboardingPhotos: created skeleton profile');
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
      if (DEBUG_PHASE2_BACKEND) {
        console.log('[P2_PROFILE_QUERY] getByAuthUserId: user record not found', {
          userId: (userId as string)?.substring(0, 8),
        });
      }
      return null;
    }

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, userId);
    if (isDeleted) {
      if (DEBUG_PHASE2_BACKEND) {
        console.log('[P2_PROFILE_QUERY] getByAuthUserId: deletion pending');
      }
      return null;
    }

    const profile = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    if (!profile) {
      if (DEBUG_PHASE2_BACKEND) {
        console.log('[P2_PROFILE_QUERY] getByAuthUserId: no profile found', {
          userId: userId?.substring(0, 8),
        });
      }
      return null;
    }

    // Always expose privateIntentKeys to clients (schema-required; normalize if ever missing in a row)
    const privateIntentKeys = profile.privateIntentKeys ?? [];

    return {
      ...profile,
      privateIntentKeys,
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
        // Patch DB immediately
        await ctx.db.patch(profile._id, {
          age: fixedAge,
          updatedAt: Date.now(),
        });
        console.log('[PRIVATE_PROFILE] getAndHealByAuthUserId: healed age', {
          userId: userId.substring(0, 8),
          previousAge: profile.age,
          fixedAge,
        });
        // Return corrected value
        returnProfile = { ...profile, age: fixedAge };
      }
    }

    // Normalize privateIntentKeys
    const privateIntentKeys = returnProfile.privateIntentKeys ?? [];

    return {
      ...returnProfile,
      privateIntentKeys,
    };
  },
});

/**
 * Upsert private profile by auth user ID.
 * Called from Phase-2 onboarding completion to persist profile to Convex.
 * IMPORTANT: Only stores backend URLs, not local file URIs.
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
    ageConfirmed18Plus: v.optional(v.boolean()),
    ageConfirmedAt: v.optional(v.number()),
    privatePhotosBlurred: v.optional(v.array(v.id('_storage'))),
    privatePhotoBlurLevel: v.optional(v.number()),
    privateDesireTagKeys: v.optional(v.array(v.string())),
    privateBoundaries: v.optional(v.array(v.string())),
    revealPolicy: v.optional(v.union(v.literal('mutual_only'), v.literal('request_based'))),
    isSetupComplete: v.optional(v.boolean()),
    hobbies: v.optional(v.array(v.string())),
    isVerified: v.optional(v.boolean()),
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

    const promptValidation = sanitizePromptAnswers(args.promptAnswers);
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

    const user = await ctx.db.get(userId);
    if (!user) {
      console.warn('[PRIVATE_PROFILE] upsertByAuthId: user record not found');
      return { success: false, error: 'user_not_found' };
    }

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, userId);
    if (isDeleted) {
      console.warn('[PRIVATE_PROFILE] upsertByAuthId: cannot update while deletion pending');
      return { success: false, error: 'deletion_pending' };
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    const now = Date.now();

    // Build profile data with defaults
    const profileData = {
      userId,
      displayName: args.displayName,
      // Canonical identity fields: backend source of truth only
      age: ageFromUser(user),
      gender: user?.gender || args.gender,
      privateBio: bioValidation.value,
      privateIntentKeys,
      privatePhotoUrls: args.privatePhotoUrls,
      city: args.city || '',
      isPrivateEnabled: args.isPrivateEnabled ?? true,
      ageConfirmed18Plus: args.ageConfirmed18Plus ?? true,
      ageConfirmedAt: args.ageConfirmedAt ?? now,
      privatePhotosBlurred: args.privatePhotosBlurred ?? [],
      privatePhotoBlurLevel: args.privatePhotoBlurLevel ?? 0,
      privateDesireTagKeys,
      privateBoundaries: args.privateBoundaries ?? [],
      revealPolicy: args.revealPolicy ?? 'mutual_only',
      isSetupComplete: args.isSetupComplete ?? false,
      hobbies: args.hobbies ?? [],
      isVerified: args.isVerified ?? false,
      // Phase-2 Onboarding Step 3: Prompt answers
      promptAnswers: promptValidation.value ?? [],
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
      console.log('[PRIVATE_PROFILE] upsertByAuthId: updated existing profile');
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
    console.log('[PRIVATE_PROFILE] upsertByAuthId: created new profile');
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
    authUserId: v.string(),
    photoBlurSlots: v.optional(v.array(v.boolean())),
    photoBlurEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.photoBlurSlots === undefined && args.photoBlurEnabled === undefined) {
      throw new Error('photoBlurSlots or photoBlurEnabled required');
    }

    // Resolve auth ID to user ID
    const userId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!userId) {
      throw new Error('Unauthorized: user not found');
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
        patch.photoBlurSlots = args.photoBlurSlots;
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
