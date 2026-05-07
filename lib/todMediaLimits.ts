export const TOD_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
export const TOD_VIDEO_MAX_BYTES = 150 * 1024 * 1024;
export const TOD_VOICE_MAX_BYTES = 15 * 1024 * 1024;

export const TOD_VIDEO_MAX_DURATION_SEC = 60;
export const TOD_VOICE_MAX_DURATION_SEC = 60;

export const TOD_MEDIA_LIMITS = {
  photo: {
    maxBytes: TOD_PHOTO_MAX_BYTES,
    allowedMimes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  },
  video: {
    maxBytes: TOD_VIDEO_MAX_BYTES,
    maxDurationSec: TOD_VIDEO_MAX_DURATION_SEC,
    allowedMimes: ['video/mp4', 'video/quicktime'],
  },
  voice: {
    maxBytes: TOD_VOICE_MAX_BYTES,
    maxDurationSec: TOD_VOICE_MAX_DURATION_SEC,
    allowedMimes: ['audio/mp4', 'audio/m4a', 'audio/aac', 'audio/mpeg'],
  },
} as const;

export type TodMediaLimitKind = keyof typeof TOD_MEDIA_LIMITS;

export function normalizeTodMime(mime: string | null | undefined): string {
  const normalized = mime?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (normalized === 'image/jpg') return 'image/jpeg';
  return normalized;
}

export function inferTodMimeFromUri(
  kind: TodMediaLimitKind,
  uri: string | null | undefined
): string | undefined {
  const normalizedUri = uri?.split('?')[0]?.toLowerCase() ?? '';

  if (kind === 'photo') {
    if (normalizedUri.endsWith('.jpg') || normalizedUri.endsWith('.jpeg')) return 'image/jpeg';
    if (normalizedUri.endsWith('.png')) return 'image/png';
    if (normalizedUri.endsWith('.webp')) return 'image/webp';
    if (normalizedUri.endsWith('.heic') || normalizedUri.endsWith('.heif')) return 'image/heic';
    return undefined;
  }

  if (kind === 'video') {
    if (normalizedUri.endsWith('.mov') || normalizedUri.endsWith('.qt')) return 'video/quicktime';
    if (normalizedUri.endsWith('.mp4') || normalizedUri.endsWith('.m4v')) return 'video/mp4';
    return undefined;
  }

  if (normalizedUri.endsWith('.mp3')) return 'audio/mpeg';
  if (normalizedUri.endsWith('.aac')) return 'audio/aac';
  if (
    normalizedUri.endsWith('.m4a') ||
    normalizedUri.endsWith('.mp4') ||
    normalizedUri.endsWith('.caf')
  ) {
    return 'audio/mp4';
  }
  return undefined;
}

export function resolveTodMime(
  kind: TodMediaLimitKind,
  uri: string | null | undefined,
  mime: string | null | undefined
): string | undefined {
  const normalizedMime = normalizeTodMime(mime);
  if (isTodAllowedMime(kind, normalizedMime)) return normalizedMime;
  return inferTodMimeFromUri(kind, uri);
}

export function formatTodMediaLimit(kind: TodMediaLimitKind): string {
  switch (kind) {
    case 'photo':
      return 'Photo must be under 20 MB.';
    case 'video':
      return 'Video must be 60 seconds or less and under 150 MB.';
    case 'voice':
      return 'Voice must be 60 seconds or less and under 15 MB.';
  }
}

export function isTodAllowedMime(kind: TodMediaLimitKind, mime: string | null | undefined): boolean {
  const normalizedMime = normalizeTodMime(mime);
  if (!normalizedMime) return false;
  return (TOD_MEDIA_LIMITS[kind].allowedMimes as readonly string[]).includes(normalizedMime);
}
