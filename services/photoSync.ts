/**
 * TASK 3: BACKEND-FIRST STORAGE (CORE FIX)
 *
 * CRITICAL PRODUCTION SAFETY:
 * - Convex backend is the SOURCE OF TRUTH for all profile photos
 * - Local storage (AsyncStorage) is a CACHE ONLY
 * - Photos are uploaded to Convex IMMEDIATELY when user adds them
 * - On app startup, photos are synced FROM Convex TO local stores (ONE-WAY)
 * - Missing local files trigger re-download from Convex, NOT deletion
 *
 * This module implements the sync layer between Convex backend and local stores.
 */

import { convex, isDemoMode } from '@/hooks/useConvex';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import * as FileSystem from 'expo-file-system/legacy';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useDemoStore } from '@/stores/demoStore';
import { PhotoSlots9, createEmptyPhotoSlots } from '@/types';

// Photo storage directory (matches photo-upload.tsx)
const PHOTOS_DIR = FileSystem.documentDirectory + 'mira/photos/';

/**
 * Ensure photos directory exists.
 */
async function ensurePhotosDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(PHOTOS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(PHOTOS_DIR, { intermediates: true });
  }
}

/**
 * Download a photo from Convex storage to local filesystem.
 *
 * @param url - The Convex storage URL
 * @param filename - Local filename to save as
 * @returns The local file:// URI, or null on failure
 */
async function downloadPhotoFromConvex(url: string, filename: string): Promise<string | null> {
  try {
    await ensurePhotosDir();
    const localUri = PHOTOS_DIR + filename;

    // Check if already downloaded
    const info = await FileSystem.getInfoAsync(localUri);
    if (info.exists) {
      if (__DEV__) console.log('[PHOTO_SYNC] Photo cached locally (Convex source confirmed):', filename);
      return localUri;
    }

    // Download from Convex
    if (__DEV__) console.log('[PHOTO_SYNC] Downloading photo from Convex:', filename);
    const downloadResult = await FileSystem.downloadAsync(url, localUri);

    if (downloadResult.status === 200) {
      if (__DEV__) console.log('[PHOTO_SYNC] Download complete:', filename);
      return localUri;
    } else {
      console.error('[PHOTO_SYNC] Download failed:', downloadResult.status);
      return null;
    }
  } catch (error) {
    console.error('[PHOTO_SYNC] Error downloading photo:', error);
    return null;
  }
}

/**
 * Sync photos from Convex backend to local stores.
 *
 * This is the CORE of backend-first storage:
 * - Fetch photos from Convex (source of truth)
 * - Download any missing files to local cache (optional, can be skipped)
 * - Update local stores with Convex data
 * - ONE-WAY sync: backend → local (never local → backend)
 *
 * @param userId - The user ID to sync photos for
 * @param forceRedownload - If true, re-download all photos even if cached
 * @param skipDownload - If true, skip downloading to local filesystem (onboarding uses backend URLs directly)
 * @returns Promise<{ success: boolean; photosCount: number; message?: string }>
 */
export async function syncPhotosFromBackend(
  userId: string,
  forceRedownload: boolean = false,
  skipDownload: boolean = false
): Promise<{ success: boolean; photosCount: number; message?: string }> {
  // Skip sync in demo mode - demo users don't have backend photos
  if (isDemoMode) {
    console.warn('[PHOTO_SYNC] ⚠️ DEMO MODE - SKIPPING CONVEX SYNC!');
    console.warn('[PHOTO_SYNC] ⚠️ Photos will be loaded from local demoStore only (not from Convex backend).');
    console.warn('[PHOTO_SYNC] ⚠️ Set EXPO_PUBLIC_DEMO_MODE=false in .env.local to sync from Convex.');
    return { success: true, photosCount: 0, message: 'Demo mode - no backend sync' };
  }

  try {
    if (__DEV__) console.log('[PHOTO_SYNC] Starting sync for userId:', userId);

    // Fetch photos from Convex (SOURCE OF TRUTH)
    const backendPhotos = await convex.query(api.photos.getUserPhotos, {
      userId: userId as Id<'users'>,
    });

    if (__DEV__) {
      console.log(`[PHOTO_SYNC] Backend has ${backendPhotos.length} photos`);
    }

    if (backendPhotos.length === 0) {
      // No photos on backend - clear local stores to match
      useOnboardingStore.getState().reorderPhotos(createEmptyPhotoSlots());
      return { success: true, photosCount: 0, message: 'No photos on backend' };
    }

    // Sort photos by order
    const sortedPhotos = [...backendPhotos].sort((a, b) => a.order - b.order);

    // ONBOARDING OPTIMIZATION: Skip download if caller only needs backend URLs
    if (skipDownload) {
      if (__DEV__) {
        console.log('[PHOTO_SYNC] skipDownload=true, using backend URLs directly (no filesystem cache)');
      }
      return {
        success: true,
        photosCount: backendPhotos.length,
        message: `Synced ${backendPhotos.length} photos (backend URLs only, no download)`,
      };
    }

    // Download photos to local cache (for non-onboarding areas)
    const localUris: (string | null)[] = [];
    for (const photo of sortedPhotos) {
      // Generate stable filename from storageId
      const filename = `photo_${photo.storageId}.jpg`;

      // Download if needed
      const localUri = await downloadPhotoFromConvex(photo.url, filename);
      localUris.push(localUri);

      if (!localUri) {
        console.warn('[PHOTO_SYNC] Failed to download photo:', photo._id);
      }
    }

    // Build PhotoSlots9 array (max 9 photos)
    const photoSlots: PhotoSlots9 = createEmptyPhotoSlots();
    for (let i = 0; i < Math.min(localUris.length, 9); i++) {
      const uri = localUris[i];
      if (uri) {
        photoSlots[i] = uri;
      }
    }

    // Update local stores with synced data
    useOnboardingStore.getState().reorderPhotos(photoSlots);

    // LIVE MODE GUARD: Only update demoStore in demo mode
    if (isDemoMode) {
      const demoPhotos = photoSlots
        .filter((uri): uri is string => uri !== null)
        .map((uri) => ({ url: uri }));
      useDemoStore.getState().saveDemoProfile(userId, { photos: demoPhotos });
    }

    if (__DEV__) {
      console.log(`[PHOTO_SYNC] Sync complete: ${localUris.filter(Boolean).length}/${backendPhotos.length} photos cached locally`);
    }

    return {
      success: true,
      photosCount: backendPhotos.length,
      message: `Synced ${backendPhotos.length} photos from backend`,
    };
  } catch (error: any) {
    console.error('[PHOTO_SYNC] Sync failed:', error);
    return {
      success: false,
      photosCount: 0,
      message: error.message || 'Photo sync failed',
    };
  }
}

/**
 * Upload a photo to Convex backend immediately.
 *
 * This is called when user adds OR replaces a photo - ensures backend is updated ASAP.
 *
 * @param userId - The user ID
 * @param localUri - The local file:// URI
 * @param isPrimary - Whether this is the primary photo
 * @param slotIndex - The slot index (0-8)
 * @param token - Optional session token for auth validation
 * @param existingPhotoId - If provided, REPLACE this existing photo instead of adding new
 * @returns Promise<{ success: boolean; storageId?: string; photoId?: string; message?: string }>
 */
export async function uploadPhotoToBackend(
  userId: string,
  localUri: string,
  isPrimary: boolean,
  slotIndex: number,
  token?: string,
  existingPhotoId?: string
): Promise<{ success: boolean; storageId?: string; photoId?: string; message?: string }> {
  // Skip upload in demo mode
  if (isDemoMode) {
    console.warn('[PHOTO_SYNC] ⚠️ DEMO MODE - SKIPPING CONVEX UPLOAD!');
    console.warn('[PHOTO_SYNC] ⚠️ Photo will be stored ONLY in local demoStore (will be lost on restart).');
    console.warn('[PHOTO_SYNC] ⚠️ Set EXPO_PUBLIC_DEMO_MODE=false in .env.local to upload to Convex.');
    return { success: true, message: 'Demo mode - no backend upload' };
  }

  // C1 SECURITY: Token required for live mode upload
  if (!token) {
    return { success: false, message: 'Authentication required for photo upload' };
  }

  try {
    if (__DEV__) {
      console.log(`[PHOTO_SYNC] Uploading photo slot ${slotIndex} to backend for userId:`, userId);
    }

    // Step 1: Get upload URL from Convex
    const uploadUrl = await convex.mutation(api.photos.generateUploadUrl);

    // Step 2: Read file as blob
    const response = await fetch(localUri);
    const blob = await response.blob();

    if (__DEV__) {
      console.log(`[PHOTO_SYNC] Uploading blob: size=${blob.size} type=${blob.type}`);
    }

    // Step 3: Upload to Convex storage
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': blob.type || 'image/jpeg',
      },
      body: blob,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed with status ${uploadResponse.status}`);
    }

    const uploadResult = await uploadResponse.json();
    const storageId = uploadResult.storageId as Id<'_storage'>;

    if (__DEV__) {
      console.log(`[PHOTO_SYNC] Photo uploaded to storage: ${storageId}`);
    }

    // H-1: Track pending upload (best-effort, non-fatal)
    try {
      await convex.mutation(api.photos.trackPendingUpload, { userId, storageId });
    } catch (e) {
      console.warn('[PHOTO_SYNC] H-1: trackPendingUpload failed (non-fatal):', e);
    }

    // Step 4: Add or Replace photo in photos table
    try {
      // REPLACE flow: Update existing photo record (preserves order/slot)
      if (existingPhotoId) {
        if (__DEV__) {
          console.log(`[PHOTO_SYNC] REPLACE mode: updating photo ${existingPhotoId} with new storage ${storageId}`);
        }

        const replaceResult = await convex.mutation(api.photos.replacePhoto, {
          photoId: existingPhotoId as Id<'photos'>,
          storageId,
          token: token!, // Token is required for replace
        });

        if (__DEV__) {
          console.log(`[PHOTO_SYNC] Photo replaced in database: ${replaceResult.photoId} at order ${replaceResult.order}`);
        }

        return {
          success: true,
          storageId,
          photoId: replaceResult.photoId,
          message: 'Photo replaced successfully',
        };
      }

      // ADD flow: Create new photo record
      const addPhotoResult = await convex.mutation(api.photos.addPhoto, {
        userId,
        storageId,
        isPrimary,
        hasFace: true, // Assume all profile photos have faces (verification happens separately)
        token, // Pass session token for auth validation
        slotOrder: slotIndex, // Use client-specified slot position (0-8)
      });

      if (__DEV__) {
        console.log(`[PHOTO_SYNC] Photo added to database: ${addPhotoResult.photoId}`);
      }

      return {
        success: true,
        storageId,
        photoId: addPhotoResult.photoId,
        message: 'Photo uploaded successfully',
      };
    } catch (mutationError: any) {
      // H-1: Cleanup orphaned storage (best-effort) for BOTH add and replace failures
      // Both flows upload new storage first, so failure leaves orphaned storage object
      try {
        await convex.mutation(api.photos.cleanupPendingUpload, { userId, storageId });
      } catch (e) {
        // M12 FIX: Log with full detail for diagnosis, not just a warning
        console.error('[PHOTO_SYNC] M12: ORPHANED STORAGE - cleanup failed');
        console.error('[PHOTO_SYNC] M12: userId:', userId, 'storageId:', storageId);
        console.error('[PHOTO_SYNC] M12: cleanup error:', e);
        // Attach orphanedStorageId to error so outer catch can expose it
        mutationError.orphanedStorageId = storageId;
      }
      throw mutationError;
    }
  } catch (error: any) {
    console.error('[PHOTO_SYNC] Upload failed:', error);
    return {
      success: false,
      message: error.message || 'Photo upload failed',
      // M12 FIX: Include orphanedStorageId if cleanup failed, for diagnosis/retry
      ...(error.orphanedStorageId ? { orphanedStorageId: error.orphanedStorageId } : {}),
    };
  }
}

/**
 * Auto-sync photos on app startup (after hydration).
 *
 * Call this from the root app component after stores have hydrated.
 * This ensures local cache is up-to-date with backend on every app launch.
 *
 * @param userId - The current user ID
 */
export async function autoSyncPhotosOnStartup(userId: string | null): Promise<void> {
  if (!userId) {
    if (__DEV__) console.log('[PHOTO_SYNC] No userId - skipping auto-sync');
    return;
  }

  if (isDemoMode) {
    if (__DEV__) console.log('[PHOTO_SYNC] Demo mode - skipping auto-sync');
    return;
  }

  // Wait a bit for hydration to complete
  await new Promise((resolve) => setTimeout(resolve, 1000));

  if (__DEV__) console.log('[PHOTO_SYNC] Running auto-sync on startup...');

  const result = await syncPhotosFromBackend(userId, false);

  if (result.success) {
    if (__DEV__) console.log('[PHOTO_SYNC] Auto-sync complete:', result.message);
  } else {
    console.warn('[PHOTO_SYNC] Auto-sync failed:', result.message);
  }
}
