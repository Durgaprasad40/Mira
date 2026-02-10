/**
 * Shared normalized profile shape used by DiscoverCardStack and Explore screens.
 */
export interface ProfileData {
  id: string;
  name: string;
  age: number;
  bio?: string;
  city?: string;
  isVerified?: boolean;
  verificationStatus?: string;
  distance?: number;
  photos: { url: string }[];
  tags?: string[];
  activities?: string[];
  relationshipIntent?: string[];
  lastActive?: number;
  createdAt?: number;
  profilePrompts?: { question: string; answer: string }[];
  /** Phase-2 only: Private intent category key */
  privateIntentKey?: string;
}

const EMPTY_PHOTOS: { url: string }[] = [];

/**
 * Normalize any raw profile shape (Convex, demo, explore) into ProfileData.
 */
export function toProfileData(p: any): ProfileData {
  // Resolve each photo to a url string, then drop empties
  const rawPhotos: { url: string }[] = Array.isArray(p.photos)
    ? p.photos
        .map((photo: any) => {
          const url = typeof photo === "string" ? photo : photo?.url;
          return typeof url === "string" && url ? { url } : null;
        })
        .filter(Boolean) as { url: string }[]
    : EMPTY_PHOTOS;

  const result: ProfileData = {
    id: p._id || p.id,
    name: p.name,
    age: p.age,
    bio: p.bio,
    city: p.city,
    isVerified: p.isVerified,
    verificationStatus: p.verificationStatus,
    distance: p.distance ?? p.distanceKm,
    photos: rawPhotos,
    tags: Array.isArray(p.tags) ? p.tags : [],
    activities: Array.isArray(p.activities) ? p.activities : [],
    relationshipIntent: Array.isArray(p.relationshipIntent)
      ? p.relationshipIntent
      : typeof p.relationshipIntent === "string"
        ? [p.relationshipIntent]
        : [],
    lastActive: p.lastActive ?? p.lastActiveAt,
    createdAt: p.createdAt,
    profilePrompts: p.profilePrompts,
    // Phase-2 only: preserve privateIntentKey if present
    privateIntentKey: p.privateIntentKey,
  };

  if (__DEV__ && rawPhotos.length === 0) {
    console.log("[ProfileData] missing photo", result.id);
  }

  return result;
}
