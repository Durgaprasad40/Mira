type ConfessionPhotoCandidate = {
  url?: string | null;
  isPrimary?: boolean | null;
  photoType?: string | null;
  isNsfw?: boolean | null;
  moderationStatus?: string | null;
  order?: number | null;
  createdAt?: number | null;
};

function isSafeConfessionPhoto(photo: ConfessionPhotoCandidate | null | undefined): photo is ConfessionPhotoCandidate {
  if (!photo?.url) return false;
  if (photo.photoType === 'verification_reference') return false;
  if (photo.isNsfw === true) return false;
  if (photo.moderationStatus === 'flagged') return false;
  return true;
}

export function pickHeroPhoto(
  photos: readonly ConfessionPhotoCandidate[] | null | undefined
): string | undefined {
  const safePhotos = (photos ?? []).filter(isSafeConfessionPhoto);
  if (safePhotos.length === 0) return undefined;

  const primaryPhoto = safePhotos.find((photo) => photo.isPrimary === true);
  if (primaryPhoto?.url) return primaryPhoto.url;

  const [fallback] = [...safePhotos].sort((a, b) => {
    const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });

  return fallback?.url ?? undefined;
}

export function pickHeroPhotoFromProfile(
  profile: { photos?: readonly ConfessionPhotoCandidate[] | null } | null | undefined
): string | undefined {
  return pickHeroPhoto(profile?.photos);
}
