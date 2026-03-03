/**
 * TASK 2: FILE EXISTENCE CHECK (SAFE GUARD)
 *
 * CRITICAL PRODUCTION SAFETY:
 * - Check if photo files exist BEFORE rendering
 * - NEVER mutate AsyncStorage based on file existence
 * - Flag missing photos for user action (re-upload)
 * - Missing files can happen when OS cleans documentDirectory (low storage, app cache clear, etc.)
 *
 * This module provides safe file existence checking WITHOUT deleting stored URIs.
 */

import * as FileSystem from 'expo-file-system/legacy';

/**
 * Check if a photo file exists on the filesystem.
 *
 * @param uri - The file:// URI to check
 * @returns Promise<boolean> - true if file exists, false otherwise
 *
 * IMPORTANT: This function ONLY checks existence - it does NOT:
 * - Delete AsyncStorage entries
 * - Mutate any state
 * - Modify photo arrays
 *
 * Callers should use this result to show UI states, not to auto-delete data.
 */
export async function checkPhotoExists(uri: string | null | undefined): Promise<boolean> {
  // Handle invalid inputs
  if (!uri || typeof uri !== 'string' || uri.length === 0) {
    return false;
  }

  // Only check file:// URIs (skip http://, https://, content://, etc.)
  if (!uri.startsWith('file://')) {
    // Remote URLs or other schemes - assume they exist (we can't check them locally)
    // If they fail to load, the Image onError handler will catch it
    return true;
  }

  try {
    const info = await FileSystem.getInfoAsync(uri);
    const exists = info.exists;

    if (__DEV__ && !exists) {
      console.warn(`[PHOTO_GUARD] File missing: ${uri.slice(-60)}`);
    }

    return exists;
  } catch (error) {
    // Filesystem error - assume file doesn't exist
    if (__DEV__) {
      console.error('[PHOTO_GUARD] getInfoAsync error:', error);
    }
    return false;
  }
}

/**
 * Batch check multiple photo URIs for existence.
 *
 * @param uris - Array of file:// URIs to check
 * @returns Promise<boolean[]> - Array of existence flags (same order as input)
 *
 * PERFORMANCE: Checks run in parallel for efficiency.
 */
export async function checkPhotosExist(uris: (string | null)[]): Promise<boolean[]> {
  const checks = uris.map((uri) => checkPhotoExists(uri));
  return Promise.all(checks);
}

/**
 * Get summary of missing photos from a photo array.
 *
 * @param photos - Array of photo URIs to check
 * @returns Promise with total count and array of missing indices
 *
 * Example:
 * ```ts
 * const result = await getPhotosMissingSummary(photos);
 * if (result.missingCount > 0) {
 *   console.warn(`${result.missingCount} photos missing at indices:`, result.missingIndices);
 * }
 * ```
 */
export async function getPhotosMissingSummary(
  photos: (string | null)[]
): Promise<{ missingCount: number; missingIndices: number[] }> {
  const existenceFlags = await checkPhotosExist(photos);

  const missingIndices: number[] = [];
  for (let i = 0; i < existenceFlags.length; i++) {
    const photo = photos[i];
    const exists = existenceFlags[i];
    // Only count as missing if:
    // 1. We have a non-empty URI stored
    // 2. File existence check returned false
    if (photo && typeof photo === 'string' && photo.length > 0 && !exists) {
      missingIndices.push(i);
    }
  }

  return {
    missingCount: missingIndices.length,
    missingIndices,
  };
}

/**
 * Validate if a URI points to a valid persistent storage location.
 *
 * This does NOT check file existence - only validates the URI format.
 *
 * CRITICAL: This is for VALIDATION ONLY during photo upload/save.
 * DO NOT use this to filter existing photos during hydration - that causes data loss.
 *
 * Valid persistent URIs:
 * - Start with file://
 * - Include /Documents/ or /files/ (platform-specific)
 * - Include mira/photos/ directory
 *
 * Invalid URIs (will be cleared by OS on app restart):
 * - Cache URIs: /cache/, /Cache/, ImageManipulator
 * - Remote URLs: http://, https://, unsplash.com
 */
export function isValidPersistentPhotoUri(uri: string | null | undefined): boolean {
  if (!uri || typeof uri !== 'string' || uri.length === 0) {
    return false;
  }

  // Must be a file:// URI
  if (!uri.startsWith('file://')) {
    return false;
  }

  // Reject cache URIs (case-insensitive check)
  const lowerUri = uri.toLowerCase();
  if (lowerUri.includes('/cache/')) {
    return false;
  }

  // Reject remote/demo URLs
  if (lowerUri.includes('unsplash.com') || lowerUri.includes('http')) {
    return false;
  }

  // Must be in persistent storage (Documents or app files directory)
  const isInDocuments = uri.includes('/Documents/') || uri.includes('/files/');
  const isInPhotosDir = uri.includes('mira/photos/');

  return isInDocuments || isInPhotosDir;
}

/**
 * Photo file state for UI rendering.
 *
 * Use this to determine how to render a photo slot:
 * - 'empty': No URI stored
 * - 'exists': File exists and can be rendered
 * - 'missing': URI stored but file not found (show re-upload UI)
 * - 'invalid': URI format is invalid (cache/remote URL)
 */
export type PhotoFileState = 'empty' | 'exists' | 'missing' | 'invalid';

/**
 * Get the file state for a photo URI (for rendering logic).
 *
 * @param uri - The photo URI to check
 * @returns Promise<PhotoFileState> - The state of this photo
 *
 * Usage in components:
 * ```tsx
 * const state = await getPhotoFileState(uri);
 * if (state === 'exists') {
 *   return <Image source={{ uri }} />;
 * } else if (state === 'missing') {
 *   return <MissingPhotoPlaceholder onReupload={() => ...} />;
 * } else {
 *   return <AddPhotoButton />;
 * }
 * ```
 */
export async function getPhotoFileState(uri: string | null | undefined): Promise<PhotoFileState> {
  // Empty slot
  if (!uri || typeof uri !== 'string' || uri.length === 0) {
    return 'empty';
  }

  // Invalid URI format (cache/remote)
  if (!isValidPersistentPhotoUri(uri)) {
    if (__DEV__) {
      console.warn('[PHOTO_GUARD] Invalid persistent URI detected:', uri.slice(-60));
    }
    return 'invalid';
  }

  // Check file existence
  const exists = await checkPhotoExists(uri);
  return exists ? 'exists' : 'missing';
}
