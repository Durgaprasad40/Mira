import { Id } from '@/convex/_generated/dataModel';
import * as FileSystem from 'expo-file-system/legacy';

// ═══════════════════════════════════════════════════════════════════════════
// FILE SIZE LIMITS (in bytes)
// ═══════════════════════════════════════════════════════════════════════════
export const FILE_SIZE_LIMITS = {
  IMAGE_MAX_BYTES: 15 * 1024 * 1024,  // 15 MB
  VIDEO_MAX_BYTES: 100 * 1024 * 1024, // 100 MB
  AUDIO_MAX_BYTES: 20 * 1024 * 1024,  // 20 MB
  DOODLE_MAX_BYTES: 5 * 1024 * 1024,  // 5 MB (small PNG)
};

export const FILE_SIZE_LIMITS_DISPLAY = {
  IMAGE: '15 MB',
  VIDEO: '100 MB',
  AUDIO: '20 MB',
  DOODLE: '5 MB',
};

type UploadMediaType = 'photo' | 'video' | 'audio' | 'doodle';

type UploadValidationOptions = {
  maxBytes?: number;
  limitMessage?: string;
  contentType?: string;
};

// ═══════════════════════════════════════════════════════════════════════════
// UPLOAD ERROR TYPES
// ═══════════════════════════════════════════════════════════════════════════
export type UploadErrorType =
  | 'FILE_TOO_LARGE'
  | 'FILE_NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'INVALID_FILE'
  | 'UPLOAD_FAILED'
  | 'SERVER_CONTRACT_ERROR'
  | 'UNKNOWN';

export class UploadError extends Error {
  type: UploadErrorType;
  retryable: boolean;

  constructor(message: string, type: UploadErrorType, retryable: boolean = false) {
    super(message);
    this.name = 'UploadError';
    this.type = type;
    this.retryable = retryable;
  }
}

/**
 * Get file size limit based on media type
 */
function getFileSizeLimit(mediaType?: UploadMediaType, options?: UploadValidationOptions): number {
  if (typeof options?.maxBytes === 'number') return options.maxBytes;
  switch (mediaType) {
    case 'video': return FILE_SIZE_LIMITS.VIDEO_MAX_BYTES;
    case 'audio': return FILE_SIZE_LIMITS.AUDIO_MAX_BYTES;
    case 'doodle': return FILE_SIZE_LIMITS.DOODLE_MAX_BYTES;
    case 'photo':
    default: return FILE_SIZE_LIMITS.IMAGE_MAX_BYTES;
  }
}

/**
 * Get human-readable file size limit
 */
function getFileSizeLimitDisplay(mediaType?: UploadMediaType): string {
  switch (mediaType) {
    case 'video': return FILE_SIZE_LIMITS_DISPLAY.VIDEO;
    case 'audio': return FILE_SIZE_LIMITS_DISPLAY.AUDIO;
    case 'doodle': return FILE_SIZE_LIMITS_DISPLAY.DOODLE;
    case 'photo':
    default: return FILE_SIZE_LIMITS_DISPLAY.IMAGE;
  }
}

/**
 * Format bytes to human-readable string
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Validate file size before upload
 * @throws UploadError if file is too large or not found
 */
export async function validateFileSize(
  uri: string,
  mediaType?: UploadMediaType,
  options?: UploadValidationOptions
): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri);

  if (!info.exists) {
    throw new UploadError(
      'File not found. It may have been deleted or moved.',
      'FILE_NOT_FOUND',
      false
    );
  }

  const fileSize = (info as any).size as number;
  const limit = getFileSizeLimit(mediaType, options);
  const limitDisplay = getFileSizeLimitDisplay(mediaType);

  if (fileSize > limit) {
    const sizeDisplay = formatFileSize(fileSize);
    const typeLabel = mediaType === 'video' ? 'Video' :
                      mediaType === 'audio' ? 'Audio' :
                      mediaType === 'doodle' ? 'Doodle' : 'Image';
    throw new UploadError(
      options?.limitMessage ??
        `${typeLabel} is too large (${sizeDisplay}). Maximum size is ${limitDisplay}.`,
      'FILE_TOO_LARGE',
      false
    );
  }

  return fileSize;
}

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
 * Exported for use in demo mode chatroom media persistence.
 */
export async function ensureStableFile(uri: string, mediaType?: 'photo' | 'video' | 'audio' | 'doodle'): Promise<string> {
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
    else if (mediaType === 'doodle') ext = '.png'; // Doodles are PNG images
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
 * Map failures from Convex `generateUploadUrl()` so missing endpoints are not
 * misreported as generic network outages.
 */
function mapConvexUploadUrlError(err: unknown): UploadError {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.toLowerCase();

  if (
    m.includes('could not find public function') ||
    m.includes('could not find function')
  ) {
    return new UploadError(
      'Upload is unavailable because the app and server are out of sync. Update the app or try again later.',
      'SERVER_CONTRACT_ERROR',
      false
    );
  }

  if (
    m.includes('network request failed') ||
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('econnrefused') ||
    m.includes('enotfound') ||
    m.includes('timed out') ||
    m.includes('timeout') ||
    m.includes('etimedout')
  ) {
    return new UploadError(
      'Unable to connect to server. Please check your connection and try again.',
      'NETWORK_ERROR',
      true
    );
  }

  return new UploadError(
    'Could not start the upload. Please try again.',
    'UPLOAD_FAILED',
    true
  );
}

/**
 * Upload a media file from a local URI to Convex storage
 * Works on real Android/iOS devices using expo-file-system uploadAsync
 * Includes file size validation and improved error handling
 * @param uri - Local file URI
 * @param generateUploadUrl - Convex mutation to generate upload URL
 * @param mediaType - Optional hint for media type detection
 * @returns Storage ID of the uploaded file
 * @throws UploadError with specific type for different failure scenarios
 */
export async function uploadMediaToConvex(
  uri: string,
  generateUploadUrl: () => Promise<string>,
  mediaType?: UploadMediaType,
  options?: UploadValidationOptions
): Promise<Id<'_storage'>> {
  const uriPrefix = uri.substring(0, Math.min(40, uri.length));
  console.log(`[UPLOAD] starting type=${mediaType ?? 'auto'} uri=${uriPrefix}...`);

  // Guard: skip upload for remote URLs (http/https)
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    console.log(`[UPLOAD] skipped - remote URL detected`);
    throw new UploadError(
      'Cannot upload remote URL. Only local files are supported.',
      'INVALID_FILE',
      false
    );
  }

  let stableUri: string | null = null;

  try {
    // Step 1: Validate file size BEFORE any other processing
    // This fails fast with a clear error if file is too large
    const fileSize = await validateFileSize(uri, mediaType, options);
    console.log(`[UPLOAD] file size validated: ${formatFileSize(fileSize)}`);

    // Step 2: Ensure we have a stable file path to upload from
    stableUri = await ensureStableFile(uri, mediaType);

    // Step 3: Get upload URL from Convex
    let uploadUrl: string;
    try {
      uploadUrl = await generateUploadUrl();
      console.log(`[UPLOAD] got uploadUrl`);
    } catch (urlError) {
      console.error(`[UPLOAD] failed to get upload URL:`, urlError);
      throw mapConvexUploadUrlError(urlError);
    }

    // Step 4: Detect content type from URI
    const contentType =
      options?.contentType ??
      getContentTypeFromUri(stableUri, mediaType as 'photo' | 'video' | 'audio');
    console.log(`[UPLOAD] contentType=${contentType}`);

    // Step 5: Upload file with timeout handling
    let uploadResult: FileSystem.FileSystemUploadResult;
    try {
      uploadResult = await FileSystem.uploadAsync(uploadUrl, stableUri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          'Content-Type': contentType,
        },
      });
    } catch (uploadError: any) {
      console.error(`[UPLOAD] uploadAsync error:`, uploadError);
      // Check for network-related errors
      const errorMessage = uploadError?.message?.toLowerCase() || '';
      if (errorMessage.includes('network') || errorMessage.includes('connection') || errorMessage.includes('timeout')) {
        throw new UploadError(
          'Upload failed due to network issues. Please check your connection and try again.',
          'NETWORK_ERROR',
          true
        );
      }
      throw new UploadError(
        'Upload was interrupted. Please try again.',
        'UPLOAD_FAILED',
        true
      );
    }

    console.log(`[UPLOAD] uploadAsync status=${uploadResult.status}`);

    // Step 6: Check for non-2xx status
    if (uploadResult.status < 200 || uploadResult.status >= 300) {
      console.error(`[UPLOAD] upload failed: ${uploadResult.status} ${uploadResult.body}`);
      if (uploadResult.status >= 500) {
        throw new UploadError(
          'Server is temporarily unavailable. Please try again in a moment.',
          'UPLOAD_FAILED',
          true
        );
      }
      throw new UploadError(
        `Upload failed (${uploadResult.status}). Please try again.`,
        'UPLOAD_FAILED',
        true
      );
    }

    // Step 7: Parse the response to get storage ID
    let result: { storageId: string };
    try {
      result = JSON.parse(uploadResult.body);
    } catch {
      console.error(`[UPLOAD] failed to parse response: ${uploadResult.body}`);
      throw new UploadError(
        'Upload completed but response was invalid. Please try again.',
        'UPLOAD_FAILED',
        true
      );
    }

    console.log(`[UPLOAD] success storageId=${result.storageId}`);

    // Step 8: Cleanup stable copy if we made one
    if (stableUri !== uri && stableUri.startsWith(FileSystem.documentDirectory || '')) {
      FileSystem.deleteAsync(stableUri, { idempotent: true }).catch(() => {});
    }

    return result.storageId as Id<'_storage'>;
  } catch (error) {
    console.error('[UPLOAD] error:', error);

    // Cleanup stable copy on error
    if (stableUri && stableUri !== uri && stableUri.startsWith(FileSystem.documentDirectory || '')) {
      FileSystem.deleteAsync(stableUri, { idempotent: true }).catch(() => {});
    }

    // Re-throw UploadError as-is (preserves type and retryable info)
    if (error instanceof UploadError) {
      throw error;
    }

    // Wrap unknown errors
    throw new UploadError(
      error instanceof Error ? error.message : 'Failed to upload media',
      'UNKNOWN',
      true
    );
  }
}

/**
 * Upload a media file from a local URI to Convex storage, with real progress updates.
 * Uses FileSystem.createUploadTask (when available) to receive byte progress callbacks.
 *
 * Safety:
 * - Keeps `uploadMediaToConvex` untouched as a fallback.
 * - If task creation/progress path fails unexpectedly, falls back to `uploadMediaToConvex` (no progress).
 */
export async function uploadMediaToConvexWithProgress(
  uri: string,
  generateUploadUrl: () => Promise<string>,
  mediaType?: UploadMediaType,
  onProgress?: (progress: number) => void,
  options?: UploadValidationOptions
): Promise<Id<'_storage'>> {
  // Guard: skip upload for remote URLs (http/https)
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    throw new UploadError(
      'Cannot upload remote URL. Only local files are supported.',
      'INVALID_FILE',
      false
    );
  }

  let stableUri: string | null = null;
  try {
    // Step 1: Validate file size
    await validateFileSize(uri, mediaType, options);

    // Step 2: Stable file path
    stableUri = await ensureStableFile(uri, mediaType);

    // Step 3: Upload URL
    let uploadUrl: string;
    try {
      uploadUrl = await generateUploadUrl();
    } catch (urlError) {
      throw mapConvexUploadUrlError(urlError);
    }

    // Step 4: Content type
    const contentType =
      options?.contentType ??
      getContentTypeFromUri(stableUri, mediaType as 'photo' | 'video' | 'audio');

    // Step 5: createUploadTask path (progress-capable)
    let task: FileSystem.UploadTask | null = null;
    try {
      task = FileSystem.createUploadTask(
        uploadUrl,
        stableUri,
        {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: {
            'Content-Type': contentType,
          },
        },
        ({ totalBytesSent, totalBytesExpectedToSend }) => {
          if (!onProgress) return;
          if (!totalBytesExpectedToSend || totalBytesExpectedToSend <= 0) return;
          const pct = Math.max(
            0,
            Math.min(100, (totalBytesSent / totalBytesExpectedToSend) * 100)
          );
          onProgress(pct);
        }
      );
    } catch (err) {
      // Fallback: if task creation fails, use existing uploadAsync path (no progress)
      return await uploadMediaToConvex(uri, generateUploadUrl, mediaType, options);
    }

    // Start at 0 for UI
    onProgress?.(0);

    const uploadResult = await task.uploadAsync();
    if (!uploadResult) {
      throw new UploadError('Upload was interrupted. Please try again.', 'UPLOAD_FAILED', true);
    }

    // Status check
    if (uploadResult.status < 200 || uploadResult.status >= 300) {
      if (uploadResult.status >= 500) {
        throw new UploadError(
          'Server is temporarily unavailable. Please try again in a moment.',
          'UPLOAD_FAILED',
          true
        );
      }
      throw new UploadError(
        `Upload failed (${uploadResult.status}). Please try again.`,
        'UPLOAD_FAILED',
        true
      );
    }

    // Parse response
    let result: { storageId: string };
    try {
      result = JSON.parse(uploadResult.body);
    } catch {
      throw new UploadError(
        'Upload completed but response was invalid. Please try again.',
        'UPLOAD_FAILED',
        true
      );
    }

    onProgress?.(100);

    // Cleanup stable copy if we made one
    if (stableUri !== uri && stableUri.startsWith(FileSystem.documentDirectory || '')) {
      FileSystem.deleteAsync(stableUri, { idempotent: true }).catch(() => {});
    }

    return result.storageId as Id<'_storage'>;
  } catch (error) {
    // Cleanup stable copy on error
    if (stableUri && stableUri !== uri && stableUri.startsWith(FileSystem.documentDirectory || '')) {
      FileSystem.deleteAsync(stableUri, { idempotent: true }).catch(() => {});
    }

    if (error instanceof UploadError) throw error;
    throw new UploadError(
      error instanceof Error ? error.message : 'Failed to upload media',
      'UNKNOWN',
      true
    );
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
