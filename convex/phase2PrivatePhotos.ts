import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';

type Phase2PhotoCtx = Pick<QueryCtx | MutationCtx, 'db' | 'storage'>;

export const PHASE2_MIN_PRIVATE_PHOTOS = 2;
export const PHASE2_MAX_PRIVATE_PHOTOS = 9;

const SAFE_PRIVATE_PHOTO_SCAN_LIMIT = 50;

type PrivatePhotoValidationResult =
  | { ok: true; urls: string[] }
  | {
      ok: false;
      error:
        | 'invalid_private_photos'
        | 'insufficient_private_photos'
        | 'too_many_private_photos';
    };

function normalizeHttpsPhotoUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  } catch {
    return null;
  }

  return trimmed;
}

function isSafeOwnedPhotoRow(photo: {
  url?: string;
  photoType?: string;
  isNsfw?: boolean;
  moderationStatus?: string;
}): boolean {
  if (photo.photoType === 'verification_reference') return false;
  if (photo.isNsfw === true) return false;
  if (photo.moderationStatus === 'flagged') return false;
  return normalizeHttpsPhotoUrl(photo.url) !== null;
}

export async function getOwnedSafePrivatePhotoUrlSet(
  ctx: Phase2PhotoCtx,
  userId: Id<'users'>,
): Promise<Set<string>> {
  const [photos, pendingUploads] = await Promise.all([
    ctx.db
      .query('photos')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .take(SAFE_PRIVATE_PHOTO_SCAN_LIMIT),
    ctx.db
      .query('pendingUploads')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .take(SAFE_PRIVATE_PHOTO_SCAN_LIMIT),
  ]);

  const safeUrls = new Set<string>();

  for (const photo of photos) {
    if (!isSafeOwnedPhotoRow(photo)) continue;
    const normalized = normalizeHttpsPhotoUrl(photo.url);
    if (normalized) safeUrls.add(normalized);
  }

  for (const pending of pendingUploads) {
    const url = await ctx.storage.getUrl(pending.storageId);
    const normalized = normalizeHttpsPhotoUrl(url);
    if (normalized) safeUrls.add(normalized);
  }

  return safeUrls;
}

export async function validateOwnedSafePrivatePhotoUrls(
  ctx: Phase2PhotoCtx,
  userId: Id<'users'>,
  rawUrls: unknown[],
  options: { requireMinimum?: boolean } = {},
): Promise<PrivatePhotoValidationResult> {
  if (!Array.isArray(rawUrls)) {
    return { ok: false, error: 'invalid_private_photos' };
  }
  if (rawUrls.length > PHASE2_MAX_PRIVATE_PHOTOS) {
    return { ok: false, error: 'too_many_private_photos' };
  }

  const normalizedUrls: string[] = [];
  const seen = new Set<string>();
  for (const value of rawUrls) {
    const normalized = normalizeHttpsPhotoUrl(value);
    if (!normalized) {
      return { ok: false, error: 'invalid_private_photos' };
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      normalizedUrls.push(normalized);
    }
  }

  if (normalizedUrls.length > PHASE2_MAX_PRIVATE_PHOTOS) {
    return { ok: false, error: 'too_many_private_photos' };
  }

  const ownedSafeUrls = await getOwnedSafePrivatePhotoUrlSet(ctx, userId);
  for (const url of normalizedUrls) {
    if (!ownedSafeUrls.has(url)) {
      return { ok: false, error: 'invalid_private_photos' };
    }
  }

  if (
    options.requireMinimum === true &&
    normalizedUrls.length < PHASE2_MIN_PRIVATE_PHOTOS
  ) {
    return { ok: false, error: 'insufficient_private_photos' };
  }

  return { ok: true, urls: normalizedUrls };
}

export async function filterOwnedSafePrivatePhotoUrls(
  ctx: Phase2PhotoCtx,
  userId: Id<'users'>,
  rawUrls: unknown[],
): Promise<string[]> {
  if (!Array.isArray(rawUrls) || rawUrls.length === 0) return [];
  const ownedSafeUrls = await getOwnedSafePrivatePhotoUrlSet(ctx, userId);
  const filtered: string[] = [];
  const seen = new Set<string>();

  for (const value of rawUrls.slice(0, PHASE2_MAX_PRIVATE_PHOTOS)) {
    const normalized = normalizeHttpsPhotoUrl(value);
    if (!normalized || !ownedSafeUrls.has(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    filtered.push(normalized);
  }

  return filtered;
}
