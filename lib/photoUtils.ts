/**
 * Photo utility functions for consistent photo handling across the app.
 */

/**
 * Get the primary photo URL from a photos array.
 *
 * ORDER-BASED PRIMARY: The first photo in the array (sorted by order) is always
 * the primary photo. The array must be pre-sorted by order.
 *
 * This function assumes photos are sorted by order (order=0 first).
 * Do NOT rely on isPrimary flag - order is the single source of truth.
 *
 * @param photos - Array of photo objects with url (must be pre-sorted by order)
 * @returns The primary photo URL, or null if no photos
 */
export function getPrimaryPhotoUrl(
  photos: { url: string; isPrimary?: boolean }[] | undefined | null
): string | null {
  if (!photos || photos.length === 0) return null;

  // ORDER IS SOURCE OF TRUTH: First photo in sorted array is primary
  // Photos should always be pre-sorted by order (order=0 first)
  return photos[0]?.url || null;
}
