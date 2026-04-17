/**
 * Shared normalized profile shape used by DiscoverCardStack and Explore screens.
 */
export interface ProfileData {
  id: string;
  /** Phase-2 only: The user ID (distinct from profile doc _id) */
  userId?: string;
  name: string;
  // IDENTITY SIMPLIFICATION: firstName/lastName removed - use single `name` field
  age?: number;
  bio?: string;
  city?: string;
  isVerified?: boolean;
  verificationStatus?: string;
  distance?: number;
  /** Candidate position (e.g. Phase-1 Discover) for client live distance; omit when distance hidden */
  latitude?: number;
  longitude?: number;
  photos: { url: string }[];
  tags?: string[];
  activities?: string[];
  relationshipIntent?: string[];
  /** User's gender for identity display */
  gender?: string;
  /** Looking for (gender preferences) */
  lookingFor?: string[];
  lastActive?: number;
  createdAt?: number;
  profilePrompts?: { question: string; answer: string }[];
  photoBlurred?: boolean;
  /** Phase-2 only: master enable for per-photo blur. */
  photoBlurEnabled?: boolean;
  /** Phase-2 only: per-photo blur slots (index aligned with `photos`). */
  photoBlurSlots?: boolean[];
  /** @deprecated Use privateIntentKeys[] instead */
  privateIntentKey?: string;
  /** Phase-2 only: Private intent category keys (multi-select, 1-5) */
  privateIntentKeys?: string[];
  /** Phase-2 only: Desire tag keys (what they're looking for) */
  desireTagKeys?: string[];
  /** True if user has incognito mode enabled */
  isIncognito?: boolean;
  /** Phase-2 only: Lifestyle data for premium card reveal */
  height?: number | null;
  smoking?: string | null;
  drinking?: string | null;
  /** Phase-2 Deep Connect: mirrors private profile setup flag when provided by the API */
  isSetupComplete?: boolean;
}

const EMPTY_PHOTOS: { url: string }[] = [];

export type RenderableProfilePhoto = {
  url: string;
  _id?: string;
  id?: string;
};

/**
 * Normalize a photo array to only renderable photos, preserving array order.
 */
export function getRenderableProfilePhotos(photos: unknown): RenderableProfilePhoto[] {
  if (!Array.isArray(photos)) return EMPTY_PHOTOS;

  return photos.flatMap((photo: any) => {
    if (typeof photo === "string") {
      const url = photo.trim();
      return url ? [{ url }] : [];
    }

    const url = typeof photo?.url === "string" ? photo.url.trim() : "";
    if (!url) return [];

    return [{
      url,
      _id: typeof photo?._id === "string" ? photo._id : undefined,
      id: typeof photo?.id === "string" ? photo.id : undefined,
    }];
  });
}

/**
 * Normalize any raw profile shape (Convex, demo, explore) into ProfileData.
 */
export function toProfileData(p: any): ProfileData {
  const rawPhotos = getRenderableProfilePhotos(p.photos);

  const result: ProfileData = {
    id: p._id || p.id,
    // Phase-2 profiles have separate userId; Phase-1 uses id as userId
    userId: p.userId,
    name: p.name,
    // IDENTITY SIMPLIFICATION: firstName/lastName removed - use single `name` field
    age: typeof p.age === "number" ? p.age : undefined,
    bio: p.bio,
    city: p.city,
    isVerified: p.isVerified,
    verificationStatus: p.verificationStatus,
    distance: p.distance ?? p.distanceKm,
    latitude: typeof p.latitude === 'number' ? p.latitude : undefined,
    longitude: typeof p.longitude === 'number' ? p.longitude : undefined,
    photos: rawPhotos,
    tags: Array.isArray(p.tags) ? p.tags : [],
    activities: Array.isArray(p.activities) ? p.activities : [],
    relationshipIntent: Array.isArray(p.relationshipIntent)
      ? p.relationshipIntent
      : typeof p.relationshipIntent === "string"
        ? [p.relationshipIntent]
        : [],
    gender: p.gender,
    lookingFor: Array.isArray(p.lookingFor) ? p.lookingFor : [],
    lastActive: p.lastActive ?? p.lastActiveAt,
    createdAt: p.createdAt,
    profilePrompts: p.profilePrompts,
    photoBlurred: p.photoBlurred === true,
    photoBlurEnabled: typeof p.photoBlurEnabled === "boolean" ? p.photoBlurEnabled : undefined,
    photoBlurSlots: Array.isArray(p.photoBlurSlots) ? p.photoBlurSlots : undefined,
    // Phase-2 only: preserve intent keys (array preferred, single for backward compat)
    privateIntentKeys: p.privateIntentKeys ?? p.intentKeys ?? (p.privateIntentKey ? [p.privateIntentKey] : undefined),
    privateIntentKey: p.privateIntentKey ?? (p.privateIntentKeys?.[0] || p.intentKeys?.[0]),
    // Phase-2 only: desire tags (what they're looking for)
    desireTagKeys: Array.isArray(p.desireTagKeys) ? p.desireTagKeys : undefined,
    // Incognito mode indicator
    isIncognito: p.isIncognito === true || p.incognitoMode === true,
    // Phase-2 only: Lifestyle data for premium card reveal
    height: p.height ?? null,
    smoking: p.smoking ?? null,
    drinking: p.drinking ?? null,
    isSetupComplete: typeof p.isSetupComplete === "boolean" ? p.isSetupComplete : undefined,
  };

  if (__DEV__ && rawPhotos.length === 0) {
    console.log("[ProfileData] missing photo", result.id);
  }

  return result;
}
