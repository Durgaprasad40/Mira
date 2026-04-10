import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { isPrivateDataDeleted } from './privateDeletion';
import { resolveUserIdByAuthId, requireAuthenticatedSessionUser } from './helpers';

const PHASE2_MIN_PHOTOS = 2;
const PHASE2_MAX_PHOTOS = 9;
const PHASE2_MIN_INTENTS = 1;
const PHASE2_MAX_INTENTS = 3;
const PHASE2_BIO_MIN_LENGTH = 30;
const PHASE2_BIO_MAX_LENGTH = 300;
const PHASE2_PROMPT_MIN_LENGTH = 20;
const PHASE2_PROMPT_MAX_LENGTH = 200;
const PHASE2_DEFAULT_BLUR_LEVEL = 12;
const PHASE2_DEFAULT_PHOTO_BLUR_SLOTS = Array.from({ length: 9 }, () => true);
const PHASE2_SECTION1_PROMPT_IDS = new Set(['prompt_1', 'prompt_2', 'prompt_3']);
const PHASE2_SECTION2_PROMPT_IDS = new Set(['prompt_4', 'prompt_5', 'prompt_6']);
const PHASE2_SECTION3_PROMPT_IDS = new Set(['prompt_7', 'prompt_8', 'prompt_9']);
const PHASE2_ALL_PROMPT_IDS = new Set([
  ...PHASE2_SECTION1_PROMPT_IDS,
  ...PHASE2_SECTION2_PROMPT_IDS,
  ...PHASE2_SECTION3_PROMPT_IDS,
]);

type Phase2PromptAnswerInput = {
  promptId: string;
  question: string;
  answer: string;
};

type Phase2OnboardingStep =
  | 'index'
  | 'select-photos'
  | 'profile-edit'
  | 'prompts'
  | 'profile-setup'
  | 'complete';

function calculateAge(dateOfBirth?: string | null): number {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    return 0;
  }

  const [year, month, day] = dateOfBirth.split('-').map(Number);
  const birthDate = new Date(year, month - 1, day, 12, 0, 0);
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) {
    age--;
  }

  return age;
}

function isPersistedPhotoUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

function normalizePersistedPhotoStorageIds(photoStorageIds: Id<'_storage'>[]): Id<'_storage'>[] {
  const normalized: Id<'_storage'>[] = [];

  for (const storageId of photoStorageIds) {
    if (!storageId) continue;
    if (!normalized.includes(storageId)) {
      normalized.push(storageId);
    }
  }

  return normalized.slice(0, PHASE2_MAX_PHOTOS);
}

function normalizeLegacyPersistedPhotoUrls(photoUrls: string[]): string[] {
  const normalized: string[] = [];

  for (const rawUrl of photoUrls) {
    const url = rawUrl.trim();
    if (!url) continue;
    if (!isPersistedPhotoUrl(url)) {
      throw new Error('Only uploaded or existing backend photos can be used in Private Mode');
    }
    if (!normalized.includes(url)) {
      normalized.push(url);
    }
  }

  return normalized.slice(0, PHASE2_MAX_PHOTOS);
}

function getLegacyPersistedPhotoUrlsForDraft(photoUrls: string[] | undefined | null): string[] {
  const normalized: string[] = [];

  for (const rawUrl of photoUrls ?? []) {
    const url = rawUrl.trim();
    if (!url || !isPersistedPhotoUrl(url)) {
      continue;
    }
    if (!normalized.includes(url)) {
      normalized.push(url);
    }
  }

  return normalized.slice(0, PHASE2_MAX_PHOTOS);
}

function getStoredPrivatePhotoStorageIds(profile: { privatePhotoStorageIds?: Id<'_storage'>[] } | null | undefined) {
  return normalizePersistedPhotoStorageIds(profile?.privatePhotoStorageIds ?? []);
}

function getStoredPrivatePhotoCount(
  profile: { privatePhotoStorageIds?: Id<'_storage'>[]; privatePhotoUrls?: string[] } | null | undefined
) {
  const storageIds = getStoredPrivatePhotoStorageIds(profile);
  if (storageIds.length > 0) {
    return storageIds.length;
  }
  return getLegacyPersistedPhotoUrlsForDraft((profile as any)?.privatePhotoUrls).length;
}

async function buildPrivatePhotoUrlsFromStorageIds(ctx: any, photoStorageIds: Id<'_storage'>[]) {
  const urls: string[] = [];
  for (const storageId of normalizePersistedPhotoStorageIds(photoStorageIds)) {
    const url = await ctx.storage.getUrl(storageId);
    if (typeof url === 'string' && isPersistedPhotoUrl(url) && !urls.includes(url)) {
      urls.push(url);
    }
  }
  return urls.slice(0, PHASE2_MAX_PHOTOS);
}

async function resolvePrivatePhotoView(
  ctx: any,
  profile: { privatePhotoStorageIds?: Id<'_storage'>[]; privatePhotoUrls?: string[] } | null | undefined
) {
  const storageIds = getStoredPrivatePhotoStorageIds(profile);
  if (storageIds.length > 0) {
    return {
      privatePhotoStorageIds: storageIds,
      privatePhotoUrls: await buildPrivatePhotoUrlsFromStorageIds(ctx, storageIds),
    };
  }

  return {
    privatePhotoStorageIds: [] as Id<'_storage'>[],
    privatePhotoUrls: getLegacyPersistedPhotoUrlsForDraft((profile as any)?.privatePhotoUrls),
  };
}

async function buildPhotoUrlToStorageIdMap(
  ctx: any,
  userId: Id<'users'>,
  existingProfile?: { privatePhotoStorageIds?: Id<'_storage'>[] } | null
) {
  const urlToStorageId = new Map<string, Id<'_storage'>>();

  const phase1Photos = await ctx.db
    .query('photos')
    .withIndex('by_user', (q: any) => q.eq('userId', userId))
    .collect();

  for (const photo of phase1Photos) {
    if (typeof photo.url === 'string' && isPersistedPhotoUrl(photo.url)) {
      urlToStorageId.set(photo.url, photo.storageId);
    }
  }

  const existingStorageIds = getStoredPrivatePhotoStorageIds(existingProfile);
  for (const storageId of existingStorageIds) {
    const url = await ctx.storage.getUrl(storageId);
    if (typeof url === 'string' && isPersistedPhotoUrl(url)) {
      urlToStorageId.set(url, storageId);
    }
  }

  const pendingUploads = await ctx.db
    .query('pendingUploads')
    .withIndex('by_user', (q: any) => q.eq('userId', userId))
    .collect();

  for (const pending of pendingUploads) {
    const url = await ctx.storage.getUrl(pending.storageId);
    if (typeof url === 'string' && isPersistedPhotoUrl(url)) {
      urlToStorageId.set(url, pending.storageId);
    }
  }

  return urlToStorageId;
}

async function resolvePrivatePhotoStorageIdsFromUrls(
  ctx: any,
  userId: Id<'users'>,
  photoUrls: string[],
  existingProfile?: { privatePhotoStorageIds?: Id<'_storage'>[]; privatePhotoUrls?: string[] } | null
) {
  const normalizedUrls = normalizeLegacyPersistedPhotoUrls(photoUrls);
  const urlToStorageId = await buildPhotoUrlToStorageIdMap(ctx, userId, existingProfile);
  const resolved: Id<'_storage'>[] = [];

  for (const photoUrl of normalizedUrls) {
    const storageId = urlToStorageId.get(photoUrl);
    if (!storageId) {
      throw new Error('Please re-select your private photos before saving.');
    }
    if (!resolved.includes(storageId)) {
      resolved.push(storageId);
    }
  }

  return normalizePersistedPhotoStorageIds(resolved);
}

async function clearPendingUploadRecordsForStorageIds(
  ctx: any,
  userId: Id<'users'>,
  photoStorageIds: Id<'_storage'>[]
) {
  if (photoStorageIds.length === 0) {
    return;
  }

  const pendingUploads = await ctx.db
    .query('pendingUploads')
    .withIndex('by_user', (q: any) => q.eq('userId', userId))
    .collect();

  const pendingToDelete = pendingUploads.filter((pending: any) => photoStorageIds.includes(pending.storageId));
  for (const pending of pendingToDelete) {
    await ctx.db.delete(pending._id);
  }
}

function validateIntentKeys(intentKeys: string[]) {
  if (intentKeys.length < PHASE2_MIN_INTENTS || intentKeys.length > PHASE2_MAX_INTENTS) {
    throw new Error(`Select ${PHASE2_MIN_INTENTS}-${PHASE2_MAX_INTENTS} intents`);
  }
}

function validatePrivateBio(privateBio: string) {
  const length = privateBio.trim().length;
  if (length < PHASE2_BIO_MIN_LENGTH || length > PHASE2_BIO_MAX_LENGTH) {
    throw new Error(`Private bio must be ${PHASE2_BIO_MIN_LENGTH}-${PHASE2_BIO_MAX_LENGTH} characters`);
  }
}

function isValidPhase2TextPromptAnswer(answer: string) {
  const length = answer.trim().length;
  return length >= PHASE2_PROMPT_MIN_LENGTH && length <= PHASE2_PROMPT_MAX_LENGTH;
}

function normalizePhase2PromptAnswers(promptAnswers: Phase2PromptAnswerInput[]) {
  const normalized = new Map<string, Phase2PromptAnswerInput>();

  for (const prompt of promptAnswers) {
    if (!PHASE2_ALL_PROMPT_IDS.has(prompt.promptId)) {
      throw new Error('Invalid Phase-2 prompt selection');
    }

    const question = prompt.question.trim();
    const answer = prompt.answer.trim();

    if (!question || !answer) {
      continue;
    }

    normalized.set(prompt.promptId, {
      promptId: prompt.promptId,
      question,
      answer,
    });
  }

  return Array.from(normalized.values());
}

function getNormalizedPhase2PromptAnswersForState(promptAnswers: Phase2PromptAnswerInput[] | undefined | null) {
  if (!Array.isArray(promptAnswers)) {
    return [];
  }
  try {
    return normalizePhase2PromptAnswers(promptAnswers);
  } catch {
    return [];
  }
}

function validatePhase2PromptAnswers(promptAnswers: Phase2PromptAnswerInput[]) {
  const hasSection1Answer = promptAnswers.some(
    (prompt) => PHASE2_SECTION1_PROMPT_IDS.has(prompt.promptId) && prompt.answer.trim().length > 0
  );
  const hasSection2Answer = promptAnswers.some(
    (prompt) => PHASE2_SECTION2_PROMPT_IDS.has(prompt.promptId) && isValidPhase2TextPromptAnswer(prompt.answer)
  );
  const hasSection3Answer = promptAnswers.some(
    (prompt) => PHASE2_SECTION3_PROMPT_IDS.has(prompt.promptId) && isValidPhase2TextPromptAnswer(prompt.answer)
  );

  if (!hasSection1Answer || !hasSection2Answer || !hasSection3Answer) {
    throw new Error('Complete all three prompt sections before continuing');
  }

  for (const prompt of promptAnswers) {
    if (PHASE2_SECTION1_PROMPT_IDS.has(prompt.promptId)) {
      continue;
    }

    if (!isValidPhase2TextPromptAnswer(prompt.answer)) {
      throw new Error(
        `Prompt answers must be ${PHASE2_PROMPT_MIN_LENGTH}-${PHASE2_PROMPT_MAX_LENGTH} characters`
      );
    }
  }
}

function resolveBlurSlots(existingSlots: boolean[] | undefined | null) {
  return Array.from({ length: 9 }, (_, index) => existingSlots?.[index] ?? PHASE2_DEFAULT_PHOTO_BLUR_SLOTS[index]);
}

function getLegacyBlurLevel(photoBlurSlots: boolean[] | undefined | null) {
  return photoBlurSlots?.some(Boolean) ? PHASE2_DEFAULT_BLUR_LEVEL : 0;
}

function hasValidLookingFor(profile: { privateIntentKeys?: string[]; privateBio?: string | null } | null) {
  const intentKeys = profile?.privateIntentKeys ?? [];
  const bio = profile?.privateBio ?? '';
  const bioLength = bio.trim().length;

  return (
    intentKeys.length >= PHASE2_MIN_INTENTS &&
    intentKeys.length <= PHASE2_MAX_INTENTS &&
    bioLength >= PHASE2_BIO_MIN_LENGTH &&
    bioLength <= PHASE2_BIO_MAX_LENGTH
  );
}

function hasValidPromptSections(profile: { promptAnswers?: Phase2PromptAnswerInput[] } | null) {
  const promptAnswers = getNormalizedPhase2PromptAnswersForState(profile?.promptAnswers);
  return {
    hasSection1Prompt: promptAnswers.some(
      (prompt) => PHASE2_SECTION1_PROMPT_IDS.has(prompt.promptId) && prompt.answer.trim().length > 0
    ),
    hasSection2Prompt: promptAnswers.some(
      (prompt) => PHASE2_SECTION2_PROMPT_IDS.has(prompt.promptId) && isValidPhase2TextPromptAnswer(prompt.answer)
    ),
    hasSection3Prompt: promptAnswers.some(
      (prompt) => PHASE2_SECTION3_PROMPT_IDS.has(prompt.promptId) && isValidPhase2TextPromptAnswer(prompt.answer)
    ),
    promptAnswers,
  };
}

function getPhase2NextOnboardingStep(
  user: { consentAcceptedAt?: number | null; privateWelcomeConfirmed?: boolean | null; phase2OnboardingCompleted?: boolean | null },
  profile: {
    privatePhotoUrls?: string[];
    privateIntentKeys?: string[];
    privateBio?: string | null;
    promptAnswers?: Phase2PromptAnswerInput[];
    isSetupComplete?: boolean | null;
  } | null
): Phase2OnboardingStep {
  if (!user.consentAcceptedAt || !user.privateWelcomeConfirmed) {
    return 'index';
  }

  if (getStoredPrivatePhotoCount(profile) < PHASE2_MIN_PHOTOS) {
    return 'select-photos';
  }

  if (!hasValidLookingFor(profile)) {
    return 'profile-edit';
  }

  const promptState = hasValidPromptSections(profile);
  if (!promptState.hasSection1Prompt || !promptState.hasSection2Prompt || !promptState.hasSection3Prompt) {
    return 'prompts';
  }

  if (!profile?.isSetupComplete || user.phase2OnboardingCompleted !== true) {
    return 'profile-setup';
  }

  return 'complete';
}

function getPhase2OnboardingRoute(step: Exclude<Phase2OnboardingStep, 'complete'>) {
  switch (step) {
    case 'index':
      return '/(main)/phase2-onboarding';
    case 'select-photos':
      return '/(main)/phase2-onboarding/select-photos';
    case 'profile-edit':
      return '/(main)/phase2-onboarding/profile-edit';
    case 'prompts':
      return '/(main)/phase2-onboarding/prompts';
    case 'profile-setup':
      return '/(main)/phase2-onboarding/profile-setup';
  }
}

async function getCurrentPrivateProfileRecord(
  ctx: any,
  userId: Id<'users'>
) {
  return await ctx.db
    .query('userPrivateProfiles')
    .withIndex('by_user', (q: any) => q.eq('userId', userId))
    .first();
}

function buildCurrentUserProfileBase(user: any, existing: any, now: number) {
  const photoBlurSlots = resolveBlurSlots(existing?.photoBlurSlots);
  const existingStorageIds = getStoredPrivatePhotoStorageIds(existing);
  return {
    userId: user._id,
    isPrivateEnabled: existing?.isPrivateEnabled ?? true,
    ageConfirmed18Plus: true,
    ageConfirmedAt: existing?.ageConfirmedAt ?? user.consentAcceptedAt ?? now,
    privatePhotosBlurred: existing?.privatePhotosBlurred ?? [],
    privatePhotoStorageIds: existingStorageIds,
    privatePhotoUrls:
      existingStorageIds.length > 0
        ? []
        : getLegacyPersistedPhotoUrlsForDraft((existing as any)?.privatePhotoUrls),
    privatePhotoBlurLevel: existing?.privatePhotoBlurLevel ?? getLegacyBlurLevel(photoBlurSlots),
    photoBlurSlots,
    privateIntentKeys: existing?.privateIntentKeys ?? [],
    privateDesireTagKeys: existing?.privateDesireTagKeys ?? [],
    privateBoundaries: existing?.privateBoundaries ?? [],
    privateBio: existing?.privateBio ?? '',
    displayName: user.handle || existing?.displayName || 'Anonymous',
    age: calculateAge(user.dateOfBirth) || existing?.age || 0,
    city: user.city ?? existing?.city ?? '',
    gender: user.gender ?? existing?.gender ?? '',
    revealPolicy: existing?.revealPolicy ?? 'mutual_only',
    isSetupComplete: existing?.isSetupComplete ?? false,
    hobbies: user.activities ?? existing?.hobbies ?? [],
    isVerified: user.isVerified ?? existing?.isVerified ?? false,
    promptAnswers: existing?.promptAnswers ?? [],
    preferenceStrength: existing?.preferenceStrength,
    height: existing?.height !== undefined ? existing.height : user.height,
    weight: existing?.weight !== undefined ? existing.weight : user.weight,
    smoking: existing?.smoking !== undefined ? existing.smoking : user.smoking,
    drinking: existing?.drinking !== undefined ? existing.drinking : user.drinking,
    education: existing?.education !== undefined ? existing.education : user.education,
    religion: existing?.religion !== undefined ? existing.religion : user.religion,
  };
}

async function upsertCurrentUserProfileDraft(
  ctx: any,
  user: any,
  updates: Record<string, unknown>
) {
  const existing = await getCurrentPrivateProfileRecord(ctx, user._id);
  const now = Date.now();
  const baseProfile = buildCurrentUserProfileBase(user, existing, now);
  const nextProfile = {
    ...baseProfile,
    ...updates,
    updatedAt: now,
  };

  const cleanProfile = Object.fromEntries(
    Object.entries(nextProfile).filter(([, value]) => value !== undefined)
  );

  if (existing) {
    await ctx.db.patch(existing._id, cleanProfile);
    return { success: true, profileId: existing._id, profile: cleanProfile };
  }

  const profileId = await ctx.db.insert('userPrivateProfiles', {
    ...cleanProfile,
    createdAt: now,
  });
  return { success: true, profileId, profile: cleanProfile };
}

function withSafeDisplayName(profile: any, user: any) {
  if (!profile) return null;
  return {
    ...profile,
    displayName: user?.handle || profile.displayName || 'Anonymous',
  };
}

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

    if (!profile) return null;

    // PHASE-2 PRIVACY FIX: Always use handle from users table, never stored displayName
    // This ensures old records with full names stored are overridden at read time
    // Phase-2 must NEVER expose first name or last name
    const user = await ctx.db.get(args.userId);
    const safeDisplayName = user?.handle || 'Anonymous';
    const photoView = await resolvePrivatePhotoView(ctx, profile);

    return {
      ...profile,
      ...photoView,
      displayName: safeDisplayName,
    };
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
    const privatePhotoStorageIds = await resolvePrivatePhotoStorageIdsFromUrls(
      ctx,
      args.userId,
      args.privatePhotoUrls,
      existing
    );

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        privatePhotoStorageIds,
        privatePhotoUrls: [],
        updatedAt: now,
      });
      await clearPendingUploadRecordsForStorageIds(ctx, args.userId, privatePhotoStorageIds);
      return { success: true, profileId: existing._id };
    }

    const profileId = await ctx.db.insert('userPrivateProfiles', {
      ...args,
      privatePhotoStorageIds,
      privatePhotoUrls: [],
      createdAt: now,
      updatedAt: now,
    });
    await clearPendingUploadRecordsForStorageIds(ctx, args.userId, privatePhotoStorageIds);
    return { success: true, profileId };
  },
});

// Update specific fields on private profile
export const updateFields = mutation({
  args: {
    userId: v.id('users'),
    isPrivateEnabled: v.optional(v.boolean()),
    privateIntentKeys: v.optional(v.array(v.string())),
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

    const { userId, ...updates } = args;
    // Remove undefined values
    const cleanUpdates: Record<string, unknown> = { updatedAt: Date.now() };
    let resolvedPrivatePhotoStorageIds: Id<'_storage'>[] | undefined;
    if (args.privatePhotoUrls !== undefined) {
      resolvedPrivatePhotoStorageIds = await resolvePrivatePhotoStorageIdsFromUrls(
        ctx,
        args.userId,
        args.privatePhotoUrls,
        existing
      );
      cleanUpdates.privatePhotoStorageIds = resolvedPrivatePhotoStorageIds;
      cleanUpdates.privatePhotoUrls = [];
    }
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && key !== 'privatePhotoUrls') {
        cleanUpdates[key] = value;
      }
    }

    await ctx.db.patch(existing._id, cleanUpdates);
    if (resolvedPrivatePhotoStorageIds) {
      await clearPendingUploadRecordsForStorageIds(ctx, args.userId, resolvedPrivatePhotoStorageIds);
    }
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

    const privatePhotoStorageIds = await resolvePrivatePhotoStorageIdsFromUrls(
      ctx,
      args.userId,
      args.privatePhotoUrls,
      existing
    );

    await ctx.db.patch(existing._id, {
      privatePhotosBlurred: args.privatePhotosBlurred,
      privatePhotoStorageIds,
      privatePhotoUrls: [],
      updatedAt: Date.now(),
    });

    await clearPendingUploadRecordsForStorageIds(ctx, args.userId, privatePhotoStorageIds);

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

    for (const storageId of getStoredPrivatePhotoStorageIds(existing)) {
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
    authUserId: v.string(),
    // Photos
    privatePhotoUrls: v.optional(v.array(v.string())),
    // Profile details
    height: v.optional(v.union(v.number(), v.null())),
    weight: v.optional(v.union(v.number(), v.null())),
    smoking: v.optional(v.union(v.string(), v.null())),
    drinking: v.optional(v.union(v.string(), v.null())),
    education: v.optional(v.union(v.string(), v.null())),
    religion: v.optional(v.union(v.string(), v.null())),
    // Other optional fields
    privateBio: v.optional(v.string()),
    privateIntentKeys: v.optional(v.array(v.string())),
    isPrivateEnabled: v.optional(v.boolean()),
    // Phase-1 imported fields (editable in Phase-2)
    hobbies: v.optional(v.array(v.string())),
    // Phase-2 Onboarding Step 4: Prompt answers
    promptAnswers: v.optional(v.array(v.object({
      promptId: v.string(),
      question: v.string(),
      answer: v.string(),
    }))),
    // Per-photo blur state (9 slots)
    photoBlurSlots: v.optional(v.array(v.boolean())),
    // P0-1 FIX: Privacy settings
    hideFromDeepConnect: v.optional(v.boolean()),
    hideAge: v.optional(v.boolean()),
    hideDistance: v.optional(v.boolean()),
    disableReadReceipts: v.optional(v.boolean()),
    // P0-2 FIX: Safe Mode setting
    safeMode: v.optional(v.boolean()),
    // P0-1 FIX: Notification settings
    notificationsEnabled: v.optional(v.boolean()),
    notificationCategories: v.optional(v.object({
      deepConnect: v.optional(v.boolean()),
      privateMessages: v.optional(v.boolean()),
      chatRooms: v.optional(v.boolean()),
      truthOrDare: v.optional(v.boolean()),
    })),
    // P0-003 FIX: Consent timestamp persistence
    consentAcceptedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!userId) {
      console.warn('[PRIVATE_PROFILE] updateFieldsByAuthId: user not found');
      return { success: false, error: 'user_not_found' };
    }

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

    // Build clean updates (only defined values)
    const { authUserId, ...updates } = args;
    const cleanUpdates: Record<string, unknown> = { updatedAt: Date.now() };
    let resolvedPrivatePhotoStorageIds: Id<'_storage'>[] | undefined;
    if (args.privatePhotoUrls !== undefined) {
      resolvedPrivatePhotoStorageIds = await resolvePrivatePhotoStorageIdsFromUrls(
        ctx,
        userId,
        args.privatePhotoUrls,
        existing
      );
      cleanUpdates.privatePhotoStorageIds = resolvedPrivatePhotoStorageIds;
      cleanUpdates.privatePhotoUrls = [];
    }
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && key !== 'privatePhotoUrls') {
        cleanUpdates[key] = value;
      }
    }

    await ctx.db.patch(existing._id, cleanUpdates);
    if (resolvedPrivatePhotoStorageIds) {
      await clearPendingUploadRecordsForStorageIds(ctx, userId, resolvedPrivatePhotoStorageIds);
    }
    console.log('[PRIVATE_PROFILE] updateFieldsByAuthId: success');
    return { success: true };
  },
});

/**
 * Update per-photo blur slots for Phase-2 profile.
 * CRITICAL: This is the backend persistence for per-photo blur feature.
 * Each slot (0-8) corresponds to a photo position.
 * true = photo is blurred to other users, false = photo is visible.
 */
export const updatePhotoBlurSlots = mutation({
  args: {
    authUserId: v.string(),
    photoBlurSlots: v.array(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Validate array length (max 9 slots)
    if (args.photoBlurSlots.length > 9) {
      console.warn('[PRIVATE_PROFILE] updatePhotoBlurSlots: invalid length');
      return { success: false, error: 'invalid_length' };
    }

    const userId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!userId) {
      console.warn('[PRIVATE_PROFILE] updatePhotoBlurSlots: user not found');
      return { success: false, error: 'user_not_found' };
    }

    // Check if private data is in pending_deletion state
    const isDeleted = await isPrivateDataDeleted(ctx, userId);
    if (isDeleted) {
      console.warn('[PRIVATE_PROFILE] updatePhotoBlurSlots: deletion pending');
      return { success: false, error: 'deletion_pending' };
    }

    const existing = await ctx.db
      .query('userPrivateProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first();

    if (!existing) {
      console.warn('[PRIVATE_PROFILE] updatePhotoBlurSlots: profile not found');
      return { success: false, error: 'profile_not_found' };
    }

    // Ensure array has exactly 9 elements (pad with false if shorter)
    const normalizedSlots = Array.from({ length: 9 }, (_, i) =>
      args.photoBlurSlots[i] ?? false
    );

    await ctx.db.patch(existing._id, {
      photoBlurSlots: normalizedSlots,
      privatePhotoBlurLevel: getLegacyBlurLevel(normalizedSlots),
      updatedAt: Date.now(),
    });

    console.log('[PRIVATE_PROFILE] updatePhotoBlurSlots: success');
    return { success: true };
  },
});

/**
 * Get private profile by auth user ID (string).
 * Resolves auth ID to Convex user ID internally.
 * Used by Phase-2 Profile tab to load backend data.
 *
 * PROFILE-P1-002 FIX: Strict server-side auth verification.
 */
export const getByAuthUserId = query({
  args: { authUserId: v.string() },
  handler: async (ctx, args) => {
    // PROFILE-P1-002 FIX: Require authentication for private profile access
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) {
      // No auth identity - deny access to private profile data
      return null;
    }
    if (identity.subject !== args.authUserId) {
      // Caller requesting a different user's profile - deny access
      return null;
    }

    const userId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!userId) {
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

    if (!profile) return null;

    // PHASE-2 PRIVACY FIX: Always use handle from users table, never stored displayName
    // This ensures old records with full names stored are overridden at read time
    // Phase-2 must NEVER expose first name or last name
    const user = await ctx.db.get(userId);
    const safeDisplayName = user?.handle || 'Anonymous';
    const photoView = await resolvePrivatePhotoView(ctx, profile);

    return {
      ...profile,
      ...photoView,
      displayName: safeDisplayName,
    };
  },
});

export const getCurrentOnboardingProfile = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedSessionUser(ctx, args.token);

    const isDeleted = await isPrivateDataDeleted(ctx, user._id);
    if (isDeleted) {
      return null;
    }

    const profile = await getCurrentPrivateProfileRecord(ctx, user._id);
    const safeProfile = withSafeDisplayName(profile, user);
    if (!safeProfile) {
      return null;
    }
    const photoView = await resolvePrivatePhotoView(ctx, safeProfile);
    return {
      ...safeProfile,
      ...photoView,
    };
  },
});

export const getPhase2OnboardingState = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedSessionUser(ctx, args.token);

    const isDeleted = await isPrivateDataDeleted(ctx, user._id);
    if (isDeleted) {
      return null;
    }

    const profile = await getCurrentPrivateProfileRecord(ctx, user._id);
    const photoCount = getStoredPrivatePhotoCount(profile);
    const promptState = hasValidPromptSections(profile);
    const nextStep = getPhase2NextOnboardingStep(user, profile);

    return {
      consentComplete: Boolean(user.consentAcceptedAt && user.privateWelcomeConfirmed),
      photoCount,
      photosComplete: photoCount >= PHASE2_MIN_PHOTOS,
      lookingForComplete: hasValidLookingFor(profile),
      hasSection1Prompt: promptState.hasSection1Prompt,
      hasSection2Prompt: promptState.hasSection2Prompt,
      hasSection3Prompt: promptState.hasSection3Prompt,
      promptsComplete:
        promptState.hasSection1Prompt &&
        promptState.hasSection2Prompt &&
        promptState.hasSection3Prompt,
      isSetupComplete: profile?.isSetupComplete === true,
      phase2OnboardingCompleted: user.phase2OnboardingCompleted === true,
      nextStep,
      nextRoute: nextStep === 'complete' ? '/(main)/(private)/(tabs)/desire-land' : getPhase2OnboardingRoute(nextStep),
    };
  },
});

export const saveOnboardingPhotos = mutation({
  args: {
    token: v.string(),
    privatePhotoUrls: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedSessionUser(ctx, args.token);

    if (!user.consentAcceptedAt || !user.privateWelcomeConfirmed) {
      throw new Error('Complete Private Mode consent before saving photos');
    }

    const isDeleted = await isPrivateDataDeleted(ctx, user._id);
    if (isDeleted) {
      throw new Error('Cannot update profile while deletion is pending');
    }

    const existing = await getCurrentPrivateProfileRecord(ctx, user._id);
    const privatePhotoStorageIds = await resolvePrivatePhotoStorageIdsFromUrls(
      ctx,
      user._id,
      args.privatePhotoUrls,
      existing
    );
    const photoBlurSlots = resolveBlurSlots(existing?.photoBlurSlots);

    const result = await upsertCurrentUserProfileDraft(ctx, user, {
      privatePhotoStorageIds,
      privatePhotoUrls: [],
      photoBlurSlots,
      privatePhotoBlurLevel: getLegacyBlurLevel(photoBlurSlots),
      isSetupComplete: false,
    });
    await clearPendingUploadRecordsForStorageIds(ctx, user._id, privatePhotoStorageIds);
    return result;
  },
});

export const saveOnboardingLookingFor = mutation({
  args: {
    token: v.string(),
    privateIntentKeys: v.array(v.string()),
    privateBio: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedSessionUser(ctx, args.token);

    if (!user.consentAcceptedAt || !user.privateWelcomeConfirmed) {
      throw new Error('Complete Private Mode consent before saving your profile');
    }

    const isDeleted = await isPrivateDataDeleted(ctx, user._id);
    if (isDeleted) {
      throw new Error('Cannot update profile while deletion is pending');
    }

    validateIntentKeys(args.privateIntentKeys);
    validatePrivateBio(args.privateBio);

    return await upsertCurrentUserProfileDraft(ctx, user, {
      privateIntentKeys: args.privateIntentKeys,
      privateBio: args.privateBio.trim(),
      isSetupComplete: false,
    });
  },
});

export const deleteOnboardingUploadedPhoto = mutation({
  args: {
    token: v.string(),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedSessionUser(ctx, args.token);

    const isDeleted = await isPrivateDataDeleted(ctx, user._id);
    if (isDeleted) {
      throw new Error('Cannot update profile while deletion is pending');
    }

    await ctx.storage.delete(args.storageId);
    return { success: true };
  },
});

export const saveOnboardingPrompts = mutation({
  args: {
    token: v.string(),
    promptAnswers: v.array(v.object({
      promptId: v.string(),
      question: v.string(),
      answer: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedSessionUser(ctx, args.token);

    if (!user.consentAcceptedAt || !user.privateWelcomeConfirmed) {
      throw new Error('Complete Private Mode consent before saving prompts');
    }

    const isDeleted = await isPrivateDataDeleted(ctx, user._id);
    if (isDeleted) {
      throw new Error('Cannot update profile while deletion is pending');
    }

    const promptAnswers = normalizePhase2PromptAnswers(args.promptAnswers);
    validatePhase2PromptAnswers(promptAnswers);

    return await upsertCurrentUserProfileDraft(ctx, user, {
      promptAnswers,
      isSetupComplete: false,
    });
  },
});

export const finalizeOnboardingProfile = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedSessionUser(ctx, args.token);

    if (!user.consentAcceptedAt || !user.privateWelcomeConfirmed) {
      throw new Error('Complete Private Mode consent before finishing onboarding');
    }

    const isDeleted = await isPrivateDataDeleted(ctx, user._id);
    if (isDeleted) {
      throw new Error('Cannot update profile while deletion is pending');
    }

    const existing = await getCurrentPrivateProfileRecord(ctx, user._id);
    if (!existing) {
      throw new Error('Complete the photo and profile steps before finishing onboarding');
    }

    const privatePhotoStorageIds =
      getStoredPrivatePhotoStorageIds(existing).length > 0
        ? getStoredPrivatePhotoStorageIds(existing)
        : await resolvePrivatePhotoStorageIdsFromUrls(
            ctx,
            user._id,
            getLegacyPersistedPhotoUrlsForDraft((existing as any)?.privatePhotoUrls),
            existing
          );
    if (privatePhotoStorageIds.length < PHASE2_MIN_PHOTOS) {
      throw new Error(`Select at least ${PHASE2_MIN_PHOTOS} photos`);
    }

    validateIntentKeys(existing.privateIntentKeys ?? []);
    validatePrivateBio(existing.privateBio ?? '');
    const promptAnswers = normalizePhase2PromptAnswers(existing.promptAnswers ?? []);
    validatePhase2PromptAnswers(promptAnswers);
    const photoBlurSlots = resolveBlurSlots(existing.photoBlurSlots);

    if (!user.gender && !existing.gender) {
      throw new Error('Finish your main profile before entering Private Mode');
    }

    const finalizeResult = await upsertCurrentUserProfileDraft(ctx, user, {
      privatePhotoStorageIds,
      privatePhotoUrls: [],
      privateIntentKeys: existing.privateIntentKeys,
      privateBio: existing.privateBio?.trim(),
      promptAnswers,
      photoBlurSlots,
      privatePhotoBlurLevel: getLegacyBlurLevel(photoBlurSlots),
      isSetupComplete: true,
      ageConfirmed18Plus: true,
      ageConfirmedAt: user.consentAcceptedAt ?? existing.ageConfirmedAt ?? Date.now(),
    });

    const phase2OnboardingCompletedAt = user.phase2OnboardingCompletedAt ?? Date.now();
    await ctx.db.patch(user._id, {
      phase2OnboardingCompleted: true,
      phase2OnboardingCompletedAt,
    });

    await ctx.runMutation(internal.phase2Ranking.initializePhase2RankingMetrics, {
      userId: user._id,
    });

    return {
      ...finalizeResult,
      phase2OnboardingCompletedAt,
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
    authUserId: v.string(),
    displayName: v.string(),
    age: v.number(),
    gender: v.string(),
    privateBio: v.optional(v.string()),
    privateIntentKeys: v.array(v.string()),
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
    // Phase-2 Onboarding Step 4: Prompt answers
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
    const userId = await resolveUserIdByAuthId(ctx, args.authUserId);
    if (!userId) {
      console.warn('[PRIVATE_PROFILE] upsertByAuthId: user not found for authId');
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
    const privatePhotoStorageIds = await resolvePrivatePhotoStorageIdsFromUrls(
      ctx,
      userId,
      args.privatePhotoUrls,
      existing
    );

    // Build profile data with defaults
    const profileData = {
      userId,
      displayName: args.displayName,
      age: args.age,
      gender: args.gender,
      privateBio: args.privateBio || '',
      privateIntentKeys: args.privateIntentKeys,
      privatePhotoStorageIds,
      privatePhotoUrls: [],
      city: args.city || '',
      isPrivateEnabled: args.isPrivateEnabled ?? true,
      ageConfirmed18Plus: args.ageConfirmed18Plus ?? true,
      ageConfirmedAt: args.ageConfirmedAt ?? now,
      privatePhotosBlurred: args.privatePhotosBlurred ?? [],
      privatePhotoBlurLevel: args.privatePhotoBlurLevel ?? 0,
      privateDesireTagKeys: args.privateDesireTagKeys ?? [],
      privateBoundaries: args.privateBoundaries ?? [],
      revealPolicy: args.revealPolicy ?? 'mutual_only',
      isSetupComplete: args.isSetupComplete ?? false,
      hobbies: args.hobbies ?? [],
      isVerified: args.isVerified ?? false,
      // Phase-2 Onboarding Step 4: Prompt answers
      promptAnswers: args.promptAnswers ?? [],
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
      await ctx.db.patch(existing._id, {
        ...profileData,
        updatedAt: now,
      });
      await clearPendingUploadRecordsForStorageIds(ctx, userId, privatePhotoStorageIds);
      console.log('[PRIVATE_PROFILE] upsertByAuthId: updated existing profile');
      return { success: true, profileId: existing._id };
    }

    const profileId = await ctx.db.insert('userPrivateProfiles', {
      ...profileData,
      createdAt: now,
      updatedAt: now,
    });
    await clearPendingUploadRecordsForStorageIds(ctx, userId, privatePhotoStorageIds);
    console.log('[PRIVATE_PROFILE] upsertByAuthId: created new profile');
    return { success: true, profileId };
  },
});
