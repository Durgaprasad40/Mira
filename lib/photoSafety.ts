/**
 * TASK 5: SAFETY & LOGGING
 *
 * CRITICAL PRODUCTION SAFETY:
 * - Add protective logging to catch photo deletion attempts
 * - Warn before any photo state mutations
 * - Block dangerous operations during hydration
 * - Require explicit user action for all deletions
 *
 * This module provides safety guards and logging to prevent data loss.
 */

/**
 * Log a warning when a photo file is missing but URI is preserved.
 *
 * This is EXPECTED behavior - local files can be deleted by OS,
 * but we preserve the URI in AsyncStorage for re-download from backend.
 *
 * @param slotIndex - The photo slot index (0-8)
 * @param uri - The missing file URI
 */
export function logPhotoFileMissing(slotIndex: number, uri: string): void {
  console.warn(
    `[PHOTO_SAFETY] Photo file missing at slot ${slotIndex} — URI preserved in store for re-download. URI: ${uri.slice(-60)}`
  );
}

/**
 * Log an error when code attempts to delete photo URIs during hydration.
 *
 * This should NEVER happen - hydration should only normalize structure,
 * never filter or delete data.
 *
 * @param location - Where the deletion was attempted (file:line)
 * @param count - Number of photos that would have been deleted
 */
export function logHydrationDeletionBlocked(location: string, count: number): void {
  console.error(
    `[PHOTO_SAFETY] ❌ CRITICAL: Attempted to delete ${count} photo URI(s) during hydration at ${location} — BLOCKED`
  );

  if (__DEV__) {
    // In dev mode, also show a stack trace to help identify the source
    console.error('[PHOTO_SAFETY] Stack trace:', new Error().stack);
  }
}

/**
 * Log when a photo is explicitly removed by user action.
 *
 * This is the ONLY acceptable way to remove photos - explicit user tap on "Remove" button.
 *
 * @param slotIndex - The photo slot index (0-8)
 * @param trigger - What triggered the removal (e.g., "user_tap_remove_button")
 */
export function logPhotoRemoved(slotIndex: number, trigger: string): void {
  if (__DEV__) {
    console.log(
      `[PHOTO_SAFETY] Photo removed at slot ${slotIndex} via ${trigger} (user-initiated)`
    );
  }
}

/**
 * Log when photos are cleared via reset/logout.
 *
 * This is acceptable for reset/logout flows.
 *
 * @param count - Number of photos cleared
 * @param trigger - What triggered the clear (e.g., "logout", "reset")
 */
export function logPhotosCleared(count: number, trigger: string): void {
  if (__DEV__) {
    console.log(
      `[PHOTO_SAFETY] Cleared ${count} photos via ${trigger} (expected behavior)`
    );
  }
}

/**
 * Log when photo sync completes.
 *
 * @param synced - Number of photos synced from backend
 * @param failed - Number of photos that failed to download
 */
export function logPhotoSyncComplete(synced: number, failed: number): void {
  if (__DEV__) {
    if (failed > 0) {
      console.warn(
        `[PHOTO_SAFETY] Sync complete: ${synced} synced, ${failed} failed to download`
      );
    } else {
      console.log(`[PHOTO_SAFETY] Sync complete: ${synced} photos synced from backend`);
    }
  }
}

/**
 * Log when a photo upload completes.
 *
 * @param slotIndex - The photo slot index (0-8)
 * @param storageId - The Convex storage ID
 */
export function logPhotoUploaded(slotIndex: number, storageId: string): void {
  if (__DEV__) {
    console.log(
      `[PHOTO_SAFETY] Photo uploaded: slot ${slotIndex} → storageId ${storageId.slice(0, 20)}...`
    );
  }
}

/**
 * Validate that a photo operation is safe.
 *
 * This is a runtime guard to prevent dangerous operations.
 *
 * @param operation - The operation being attempted
 * @param context - Additional context (e.g., "during_hydration", "user_action")
 * @returns true if operation is safe, false if blocked
 */
export function validatePhotoOperation(
  operation: 'delete' | 'clear' | 'filter',
  context: 'during_hydration' | 'user_action' | 'logout' | 'reset'
): boolean {
  // CRITICAL: NEVER allow delete/clear/filter during hydration
  if (context === 'during_hydration') {
    console.error(
      `[PHOTO_SAFETY] ❌ BLOCKED: ${operation} operation during hydration is FORBIDDEN`
    );
    return false;
  }

  // User-initiated actions are always safe
  if (context === 'user_action') {
    return true;
  }

  // Logout/reset are expected to clear photos
  if (context === 'logout' || context === 'reset') {
    return true;
  }

  // Unknown context - block by default
  console.error(
    `[PHOTO_SAFETY] ❌ BLOCKED: ${operation} operation with unknown context: ${context}`
  );
  return false;
}

/**
 * DEVELOPMENT ONLY: Assert that no photos are being deleted during hydration.
 *
 * Call this before and after hydration logic to detect data loss.
 *
 * @param beforePhotos - Photos array before operation
 * @param afterPhotos - Photos array after operation
 * @param operationName - Name of the operation for logging
 */
export function assertNoPhotosLostDuringHydration(
  beforePhotos: (string | null)[],
  afterPhotos: (string | null)[],
  operationName: string
): void {
  if (!__DEV__) return;

  const beforeCount = beforePhotos.filter((p) => p !== null && p !== '').length;
  const afterCount = afterPhotos.filter((p) => p !== null && p !== '').length;

  if (afterCount < beforeCount) {
    const lostCount = beforeCount - afterCount;
    console.error(
      `[PHOTO_SAFETY] ❌ DATA LOSS DETECTED: ${operationName} lost ${lostCount} photos! Before: ${beforeCount}, After: ${afterCount}`
    );
    console.error('[PHOTO_SAFETY] Before:', beforePhotos);
    console.error('[PHOTO_SAFETY] After:', afterPhotos);

    // In dev mode, throw error to force developer to fix
    throw new Error(
      `PHOTO DATA LOSS: ${operationName} deleted ${lostCount} photos during hydration`
    );
  }
}

/**
 * Get a summary of photo storage state for debugging.
 *
 * @param photos - Photos array to analyze
 * @returns Summary object with counts and warnings
 */
export function getPhotoStorageSummary(photos: (string | null)[]): {
  total: number;
  empty: number;
  cacheUris: number;
  persistentUris: number;
  invalidUris: number;
  warnings: string[];
} {
  let empty = 0;
  let cacheUris = 0;
  let persistentUris = 0;
  let invalidUris = 0;
  const warnings: string[] = [];

  for (const photo of photos) {
    if (!photo || photo === '') {
      empty++;
    } else if (typeof photo === 'string') {
      // Check if it's a cache URI (should not be stored long-term)
      if (photo.includes('/cache/') || photo.includes('/Cache/')) {
        cacheUris++;
        warnings.push(`Cache URI detected (will be cleared on restart): ${photo.slice(-60)}`);
      }
      // Check if it's a persistent URI
      else if (photo.includes('/Documents/') || photo.includes('/files/')) {
        persistentUris++;
      }
      // Invalid URI format
      else if (!photo.startsWith('file://')) {
        invalidUris++;
        warnings.push(`Invalid URI format: ${photo.slice(-60)}`);
      }
    }
  }

  return {
    total: photos.length,
    empty,
    cacheUris,
    persistentUris,
    invalidUris,
    warnings,
  };
}
