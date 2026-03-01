import { Id } from '@/convex/_generated/dataModel';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Detect content type from URI extension
 */
function getContentTypeFromUri(uri: string, mediaType?: 'photo' | 'video' | 'audio'): string {
  const lower = uri.toLowerCase();

  // Audio types - use audio/mp4 for m4a (standard MIME type)
  if (mediaType === 'audio' || lower.includes('.m4a') || lower.includes('.aac') || lower.includes('.caf')) {
    if (lower.includes('.mp3')) return 'audio/mpeg';
    if (lower.includes('.wav')) return 'audio/wav';
    if (lower.includes('.ogg')) return 'audio/ogg';
    if (lower.includes('.aac')) return 'audio/aac';
    // Default for iOS/Android recordings (.m4a) - use standard audio/mp4
    return 'audio/mp4';
  }

  // Video types
  if (mediaType === 'video' || lower.includes('.mp4') || lower.includes('.mov') || lower.includes('.m4v')) {
    if (lower.includes('.mov')) return 'video/quicktime';
    if (lower.includes('.webm')) return 'video/webm';
    return 'video/mp4';
  }

  // Image types
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.gif')) return 'image/gif';
  if (lower.includes('.webp')) return 'image/webp';
  if (lower.includes('.heic') || lower.includes('.heif')) return 'image/heic';

  // Default to JPEG for jpg, jpeg, or unknown images
  return 'image/jpeg';
}

/**
 * Ensure file exists at a stable path. Copies if necessary.
 * Returns the path to read from (may be different from input).
 */
async function ensureStableFile(uri: string, mediaType?: 'photo' | 'video' | 'audio'): Promise<string> {
  const uriPrefix = uri.substring(0, Math.min(50, uri.length));

  // Check if file exists
  const info = await FileSystem.getInfoAsync(uri);
  console.log(`[T/D UPLOAD] exists=${info.exists} size=${info.exists ? (info as any).size : 0}`);

  // Determine if we need to copy to stable location
  const needsCopy =
    !info.exists ||
    uri.includes('/cache/ImagePicker/') ||
    uri.includes('/Cache/') ||
    uri.includes('/AV/') ||
    uri.startsWith('content://');

  if (needsCopy) {
    // Determine extension based on media type
    let ext = '.jpg';
    if (mediaType === 'video') ext = '.mp4';
    else if (mediaType === 'audio') ext = '.m4a';
    else if (uri.includes('.png')) ext = '.png';
    else if (uri.includes('.mp4')) ext = '.mp4';
    else if (uri.includes('.mov')) ext = '.mov';
    else if (uri.includes('.m4a')) ext = '.m4a';

    const stablePath = `${FileSystem.documentDirectory}tod_upload_${Date.now()}${ext}`;

    console.log(`[T/D UPLOAD] copying to stable path...`);
    try {
      await FileSystem.copyAsync({ from: uri, to: stablePath });
      console.log(`[T/D UPLOAD] copied_to=${stablePath.substring(0, 40)}...`);

      // Verify copy succeeded
      const copyInfo = await FileSystem.getInfoAsync(stablePath);
      if (!copyInfo.exists) {
        throw new Error('Copy failed - file does not exist at destination');
      }
      return stablePath;
    } catch (copyErr) {
      console.error(`[T/D UPLOAD] copy failed:`, copyErr);
      // If copy failed but original exists, try original anyway
      if (info.exists) {
        console.log(`[T/D UPLOAD] falling back to original uri`);
        return uri;
      }
      throw new Error(`File not accessible: ${uriPrefix}`);
    }
  }

  return uri;
}

export interface UploadResult {
  storageId: Id<'_storage'>;
}

/**
 * Upload a media file from a local URI to Convex storage
 * Works on real Android/iOS devices using expo-file-system uploadAsync
 * @param uri - Local file URI
 * @param generateUploadUrl - Convex mutation to generate upload URL
 * @param mediaType - Optional hint for media type detection
 * @returns Storage ID of the uploaded file
 */
export async function uploadMediaToConvex(
  uri: string,
  generateUploadUrl: () => Promise<string>,
  mediaType?: 'photo' | 'video' | 'audio'
): Promise<Id<'_storage'>> {
  const uriPrefix = uri.substring(0, Math.min(40, uri.length));
  console.log(`[T/D UPLOAD] starting type=${mediaType ?? 'auto'} uri=${uriPrefix}...`);

  // Guard: skip upload for remote URLs (http/https)
  // These are already stored remotely and shouldn't be re-uploaded
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    console.log(`[T/D UPLOAD] skipped - remote URL detected, uri=${uriPrefix}`);
    throw new Error('Cannot upload remote URL. Only local files (file://, content://) are supported.');
  }

  try {
    // Ensure we have a stable file path to upload from
    const stableUri = await ensureStableFile(uri, mediaType);

    // Get upload URL from Convex
    const uploadUrl = await generateUploadUrl();
    console.log(`[T/D UPLOAD] got uploadUrl`);

    // Detect content type from URI
    const contentType = getContentTypeFromUri(stableUri, mediaType);
    console.log(`[T/D UPLOAD] contentType=${contentType}`);

    // Upload file directly using FileSystem.uploadAsync with BINARY_CONTENT
    // No base64/Blob conversion - works on real Android devices
    const uploadResult = await FileSystem.uploadAsync(uploadUrl, stableUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        'Content-Type': contentType,
      },
    });

    console.log(`[T/D UPLOAD] uploadAsync status=${uploadResult.status}`);

    // Check for non-2xx status
    if (uploadResult.status < 200 || uploadResult.status >= 300) {
      console.error(`[T/D UPLOAD] upload failed: ${uploadResult.status} ${uploadResult.body}`);
      throw new Error(`Upload failed: ${uploadResult.status}`);
    }

    // Parse the response to get storage ID
    let result: { storageId: string };
    try {
      result = JSON.parse(uploadResult.body);
    } catch {
      console.error(`[T/D UPLOAD] failed to parse response: ${uploadResult.body}`);
      throw new Error('Upload failed: invalid response');
    }

    console.log(`[T/D UPLOAD] success storageId=${result.storageId}`);

    // Cleanup: delete the stable copy if we made one
    if (stableUri !== uri && stableUri.startsWith(FileSystem.documentDirectory || '')) {
      FileSystem.deleteAsync(stableUri, { idempotent: true }).catch(() => {});
    }

    return result.storageId as Id<'_storage'>;
  } catch (error) {
    console.error('[T/D UPLOAD] error:', error);
    throw error instanceof Error ? error : new Error('Failed to upload media');
  }
}

/**
 * Upload a photo from a local URI to Convex storage (backward compat)
 */
export async function uploadPhotoToConvex(
  photoUri: string,
  generateUploadUrl: () => Promise<string>
): Promise<Id<'_storage'>> {
  return uploadMediaToConvex(photoUri, generateUploadUrl, 'photo');
}

/**
 * Upload an audio file from a local URI to Convex storage
 */
export async function uploadAudioToConvex(
  audioUri: string,
  generateUploadUrl: () => Promise<string>
): Promise<Id<'_storage'>> {
  return uploadMediaToConvex(audioUri, generateUploadUrl, 'audio');
}

/**
 * Upload a video file from a local URI to Convex storage
 */
export async function uploadVideoToConvex(
  videoUri: string,
  generateUploadUrl: () => Promise<string>
): Promise<Id<'_storage'>> {
  return uploadMediaToConvex(videoUri, generateUploadUrl, 'video');
}

/**
 * Upload multiple photos to Convex storage in parallel
 * @param photoUris - Array of local file URIs
 * @param generateUploadUrl - Convex mutation to generate upload URL
 * @returns Array of storage IDs
 */
export async function uploadPhotosToConvex(
  photoUris: string[],
  generateUploadUrl: () => Promise<string>
): Promise<Id<'_storage'>[]> {
  // Upload all photos in parallel for better performance
  const uploadPromises = photoUris.map(uri =>
    uploadPhotoToConvex(uri, generateUploadUrl)
  );

  return Promise.all(uploadPromises);
}
