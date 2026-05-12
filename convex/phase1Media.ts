import { Doc } from "./_generated/dataModel";

type Phase1DisplayPhotoSafetyFields = Pick<
  Doc<"photos">,
  "url" | "photoType" | "isNsfw" | "moderationStatus"
> & {
  hidden?: boolean;
  isHidden?: boolean;
  deleted?: boolean;
  isDeleted?: boolean;
  deletedAt?: number | null;
  unsafe?: boolean;
  isUnsafe?: boolean;
};

type Phase1DisplayPhotoOrderFields = Phase1DisplayPhotoSafetyFields &
  Pick<Doc<"photos">, "isPrimary" | "order"> &
  Partial<Pick<Doc<"photos">, "createdAt">>;

export function isSafePhase1DisplayPhotoUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();
  return lower.startsWith("https://") || lower.startsWith("http://");
}

export function isSafePhase1DisplayPhoto(photo: Phase1DisplayPhotoSafetyFields): boolean {
  if (photo.photoType === "verification_reference") return false;
  if (photo.isNsfw === true) return false;
  if (photo.moderationStatus === "flagged") return false;
  if (!isSafePhase1DisplayPhotoUrl(photo.url)) return false;

  if (photo.hidden === true || photo.isHidden === true) return false;
  if (photo.deleted === true || photo.isDeleted === true || typeof photo.deletedAt === "number") {
    return false;
  }
  if (photo.unsafe === true || photo.isUnsafe === true) return false;

  return true;
}

export function filterSafePhase1DisplayPhotos<T extends Phase1DisplayPhotoSafetyFields>(
  photos: readonly T[]
): T[] {
  return photos.filter((photo) => isSafePhase1DisplayPhoto(photo));
}

function comparePhase1DisplayPhotoOrder(
  a: Phase1DisplayPhotoOrderFields,
  b: Phase1DisplayPhotoOrderFields
): number {
  if (a.order !== b.order) return a.order - b.order;
  return (a.createdAt ?? 0) - (b.createdAt ?? 0);
}

export function orderSafePhase1DisplayPhotos<T extends Phase1DisplayPhotoOrderFields>(
  photos: readonly T[]
): T[] {
  const safePhotos = filterSafePhase1DisplayPhotos(photos);
  const primaryPhoto = safePhotos.find((photo) => photo.isPrimary === true);
  const otherPhotos = safePhotos
    .filter((photo) => photo !== primaryPhoto)
    .sort(comparePhase1DisplayPhotoOrder);

  return primaryPhoto
    ? [primaryPhoto, ...otherPhotos]
    : [...safePhotos].sort(comparePhase1DisplayPhotoOrder);
}

export function getSafePhase1PrimaryPhoto<T extends Phase1DisplayPhotoOrderFields>(
  photos: readonly T[]
): T | null {
  return orderSafePhase1DisplayPhotos(photos)[0] ?? null;
}
