/**
 * Shared normalized profile shape used by DiscoverCardStack and Explore screens.
 */
export interface ProfileData {
  id: string;
  /** Phase-2 only: The user ID (distinct from profile doc _id) */
  userId?: string;
  name: string;
  age?: number;
  ageHidden?: boolean;
  bio?: string;
  city?: string;
  isVerified?: boolean;
  verificationStatus?: string;
  distance?: number;
  distanceHidden?: boolean;
  photos: { url: string | null }[];
  photoBlurred?: boolean;
  tags?: string[];
  activities?: string[];
  relationshipIntent?: string[];
  lastActive?: number;
  isActiveNow?: boolean;
  wasActiveToday?: boolean;
  createdAt?: number;
  profilePrompts?: { question: string; answer: string }[];
  /** @deprecated Use privateIntentKeys[] instead */
  privateIntentKey?: string;
  /** Phase-2 only: Private intent category keys (multi-select, 1-5) */
  privateIntentKeys?: string[];
  /** True if user has incognito mode enabled */
  isIncognito?: boolean;
}

const EMPTY_PHOTOS: { url: string | null }[] = [];

/**
 * Normalize any raw profile shape (Convex, demo, explore) into ProfileData.
 */
export function toProfileData(p: any): ProfileData {
  // Resolve each photo to a url string or explicit null placeholder.
  const rawPhotos: { url: string | null }[] = Array.isArray(p.photos)
    ? p.photos
        .map((photo: any) => {
          if (typeof photo === "string") {
            return photo ? { url: photo } : null;
          }
          if (typeof photo?.url === "string") {
            return photo.url ? { url: photo.url } : null;
          }
          if (photo?.url === null) {
            return { url: null };
          }
          return null;
        })
        .filter(Boolean) as { url: string | null }[]
    : EMPTY_PHOTOS;

  const result: ProfileData = {
    id: p._id || p.id,
    // Phase-2 profiles have separate userId; Phase-1 uses id as userId
    userId: p.userId,
    name: p.name,
    age: p.age,
    ageHidden: p.ageHidden === true,
    bio: p.bio,
    city: p.city,
    isVerified: p.isVerified,
    verificationStatus: p.verificationStatus,
    distance: p.distance ?? p.distanceKm,
    distanceHidden: p.distanceHidden === true,
    photos: rawPhotos,
    photoBlurred: p.photoBlurred === true || p.isBlurred === true,
    tags: Array.isArray(p.tags) ? p.tags : [],
    activities: Array.isArray(p.activities) ? p.activities : [],
    relationshipIntent: Array.isArray(p.relationshipIntent)
      ? p.relationshipIntent
      : typeof p.relationshipIntent === "string"
        ? [p.relationshipIntent]
        : [],
    lastActive: p.lastActive ?? p.lastActiveAt,
    isActiveNow: p.isActiveNow === true,
    wasActiveToday: p.wasActiveToday === true,
    createdAt: p.createdAt,
    profilePrompts: p.profilePrompts,
    // Phase-2 only: preserve intent keys (array preferred, single for backward compat)
    privateIntentKeys: p.privateIntentKeys ?? p.intentKeys ?? (p.privateIntentKey ? [p.privateIntentKey] : undefined),
    privateIntentKey: p.privateIntentKey ?? (p.privateIntentKeys?.[0] || p.intentKeys?.[0]),
    // Incognito mode indicator
    isIncognito: p.isIncognito === true || p.incognitoMode === true,
  };

  if (__DEV__ && rawPhotos.length === 0) {
    console.log("[ProfileData] missing photo", result.id);
  }

  return result;
}
