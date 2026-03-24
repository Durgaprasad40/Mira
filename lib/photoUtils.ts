/**
 * Photo utility functions for consistent photo handling across the app.
 */

/**
 * Get the primary photo URL from a photos array.
 *
 * This function correctly handles the isPrimary flag to find the main/starred photo,
 * with fallback to the first photo if no isPrimary flag is set.
 *
 * BUG FIX: Previously, many screens used photos[0] directly, which would show
 * the wrong photo if the user had starred a different photo as their primary.
 *
 * @param photos - Array of photo objects with url and optional isPrimary flag
 * @returns The primary photo URL, or null if no photos
 */
export function getPrimaryPhotoUrl(
  photos: { url: string; isPrimary?: boolean }[] | undefined | null
): string | null {
  if (!photos || photos.length === 0) return null;

  // Find photo with isPrimary flag (the starred/main photo)
  const primaryPhoto = photos.find((p) => p.isPrimary);

  // Fallback to first photo if no isPrimary flag exists (legacy data)
  const photo = primaryPhoto || photos[0];

  return photo?.url || null;
}
