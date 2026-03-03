/**
 * PHASE-1 PROFILE PHOTO HARD LOCK - RUNTIME GUARDS
 *
 * ════════════════════════════════════════════════════════════════════════
 * NON-NEGOTIABLE RULES (ENFORCED AT RUNTIME)
 * ════════════════════════════════════════════════════════════════════════
 *
 * 1) Phase-1 profile photos MUST be stored ONLY in Convex backend
 * 2) Convex storage is the SINGLE SOURCE OF TRUTH
 * 3) Local file:// URIs are CACHE ONLY, never storage
 * 4) AsyncStorage is NEVER a source of truth for photos
 * 5) NO Phase-1 profile photo may exist without a Convex storageId
 *
 * This module provides runtime enforcement of these rules.
 */

import { isDemoMode } from '@/hooks/useConvex';

/**
 * Deletion events that MUST NOT delete profile photos.
 */
const FORBIDDEN_DELETION_EVENTS = [
  'app_restart',
  'hydration',
  'migration',
  'phase_switch',
  'verification_change',
  'os_cleanup',
  'app_update',
  'auth_refresh',
] as const;

type ForbiddenDeletionEvent = typeof FORBIDDEN_DELETION_EVENTS[number];

/**
 * Allowed deletion events (explicit user action only).
 */
const ALLOWED_DELETION_EVENTS = [
  'user_tap_delete',
  'user_tap_remove',
  'account_deletion',
  'logout',
  'reset',
] as const;

type AllowedDeletionEvent = typeof ALLOWED_DELETION_EVENTS[number];

type DeletionEvent = ForbiddenDeletionEvent | AllowedDeletionEvent;

/**
 * HARD LOCK: Block photo deletion unless explicitly allowed.
 *
 * @param event - The event triggering the deletion
 * @param context - Additional context for logging
 * @returns true if deletion is allowed, false if blocked
 *
 * @throws Error in dev mode if deletion is forbidden
 */
export function allowPhotoDeletion(
  event: DeletionEvent,
  context?: string
): boolean {
  // Check if event is forbidden
  if (FORBIDDEN_DELETION_EVENTS.includes(event as ForbiddenDeletionEvent)) {
    const errorMsg = `[PHOTO_LOCK] ❌ BLOCKED: Photo deletion on '${event}' is FORBIDDEN. Context: ${context || 'none'}`;
    console.error(errorMsg);

    if (__DEV__) {
      // In dev mode, throw error to force developer to fix
      throw new Error(errorMsg);
    }

    return false;
  }

  // Check if event is explicitly allowed
  if (ALLOWED_DELETION_EVENTS.includes(event as AllowedDeletionEvent)) {
    if (__DEV__) {
      console.log(`[PHOTO_LOCK] ✅ ALLOWED: Photo deletion on '${event}'. Context: ${context || 'none'}`);
    }
    return true;
  }

  // Unknown event - block by default
  const errorMsg = `[PHOTO_LOCK] ❌ BLOCKED: Unknown deletion event '${event}'. Context: ${context || 'none'}`;
  console.error(errorMsg);

  if (__DEV__) {
    throw new Error(errorMsg);
  }

  return false;
}

/**
 * HARD LOCK: Assert that backend upload happened before storing photo.
 *
 * @param uploadResult - Result from uploadPhotoToBackend()
 * @param slotIndex - Photo slot index
 *
 * @throws Error if upload failed or storageId missing
 */
export function assertBackendUploadSucceeded(
  uploadResult: { success: boolean; storageId?: string; message?: string },
  slotIndex: number
): void {
  if (!uploadResult.success) {
    const errorMsg = `[PHOTO_LOCK] ❌ CRITICAL: Backend upload failed for slot ${slotIndex}. Cannot store photo without Convex storageId. Error: ${uploadResult.message}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  if (!uploadResult.storageId) {
    const errorMsg = `[PHOTO_LOCK] ❌ CRITICAL: Backend upload succeeded but storageId is missing for slot ${slotIndex}. This violates HARD LOCK rules.`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  if (__DEV__) {
    console.log(`[PHOTO_LOCK] ✅ Backend upload verified: slot ${slotIndex}, storageId=${uploadResult.storageId}`);
  }
}

/**
 * HARD LOCK: Block storing photos without backend upload (except demo mode).
 *
 * @param hasBackendStorageId - Whether photo has a Convex storageId
 * @param slotIndex - Photo slot index
 *
 * @throws Error if trying to store photo without backend upload
 */
export function assertBackendFirstStorage(
  hasBackendStorageId: boolean,
  slotIndex: number
): void {
  if (isDemoMode) {
    // Demo mode is exempt from backend requirement
    return;
  }

  if (!hasBackendStorageId) {
    const errorMsg = `[PHOTO_LOCK] ❌ CRITICAL: Attempted to store photo at slot ${slotIndex} without Convex storageId. This violates HARD LOCK: backend-only storage.`;
    console.error(errorMsg);

    if (__DEV__) {
      throw new Error(errorMsg);
    }
  }
}

/**
 * HARD LOCK: Verify photo exists in Convex backend.
 *
 * Use this before rendering/displaying a photo to ensure it's backed by Convex.
 *
 * @param storageId - Convex storage ID (or null if missing)
 * @param slotIndex - Photo slot index
 * @returns true if photo has valid backend storage, false otherwise
 */
export function hasBackendStorage(
  storageId: string | null | undefined,
  slotIndex: number
): boolean {
  if (isDemoMode) {
    // Demo mode doesn't use backend
    return false;
  }

  const hasStorage = !!(storageId && typeof storageId === 'string' && storageId.length > 0);

  if (!hasStorage && __DEV__) {
    console.warn(`[PHOTO_LOCK] ⚠️ Photo at slot ${slotIndex} has no Convex storageId (local cache only)`);
  }

  return hasStorage;
}

/**
 * HARD LOCK: Log when photo is stored locally without backend upload.
 *
 * This should ONLY happen in demo mode or during migration.
 *
 * @param slotIndex - Photo slot index
 * @param reason - Why backend upload was skipped
 */
export function logLocalOnlyStorage(slotIndex: number, reason: 'demo_mode' | 'migration'): void {
  if (__DEV__) {
    console.warn(
      `[PHOTO_LOCK] ⚠️ Local-only storage at slot ${slotIndex} (reason: ${reason}). ` +
      'This should ONLY happen in demo mode or during migration.'
    );
  }
}
