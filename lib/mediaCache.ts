/**
 * mediaCache.ts — Generic photo + video caching utility (frontend-only)
 *
 * Implements WhatsApp/Telegram-style download-first behavior:
 *   - Tap arrow → download → preview / instant open
 *   - In-memory map: remoteUrl → localUri (instant cache hit)
 *   - In-progress dedup: never download the same URL twice in parallel
 *   - Persistent disk cache under FileSystem.cacheDirectory (survives restarts)
 *   - Per-URL delete helper for secure-media expiry cleanup
 *
 * NOT in scope:
 *   - No save-to-gallery / MediaLibrary
 *   - No exact byte progress (spinner only); we don't fake percentages
 *   - No backend changes; backend remains source of truth for view/expiry
 *
 * Usage:
 *   import { getMediaUri, getCachedMediaUri, deleteCachedMedia } from '@/lib/mediaCache';
 *
 *   // Synchronous cache check (instant)
 *   const cached = getCachedMediaUri(remoteUrl);
 *
 *   // Tap-to-load: download (or return cached)
 *   const localUri = await getMediaUri(remoteUrl, 'image');
 *
 *   // Secure-media expiry cleanup
 *   await deleteCachedMedia(remoteUrl);
 */

import * as FileSystem from 'expo-file-system/legacy';

const MEDIA_CACHE_DIR = `${FileSystem.cacheDirectory}media-cache/`;

// In-memory map: remoteUrl -> localUri
const memoryCache = new Map<string, string>();

// In-progress downloads: remoteUrl -> Promise<localUri>
const inProgressDownloads = new Map<string, Promise<string>>();

let isInitialized = false;

export type MediaKind = 'image' | 'video';

async function ensureCacheDir(): Promise<void> {
  if (isInitialized) return;
  try {
    const dirInfo = await FileSystem.getInfoAsync(MEDIA_CACHE_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(MEDIA_CACHE_DIR, { intermediates: true });
    }
    isInitialized = true;
  } catch (error) {
    console.warn('[MediaCache] Failed to create cache directory:', error);
  }
}

/**
 * Hash function (matches videoCache pattern). Uses 32-bit folding hash so the
 * same URL always maps to the same on-disk filename.
 */
function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Pick a sensible file extension based on URL path + kind.
 * - Image URLs may end in .jpg/.jpeg/.png/.webp/.heic → preserved
 * - Video URLs may end in .mp4/.mov/.webm/.avi/.m4v → preserved
 * - Otherwise default to .jpg for images and .mp4 for videos
 */
function pickExtension(url: string, kind: MediaKind): string {
  const urlPath = url.split('?')[0];
  if (kind === 'image') {
    return urlPath.match(/\.(jpe?g|png|webp|heic|gif)$/i)?.[0] || '.jpg';
  }
  return urlPath.match(/\.(mp4|mov|webm|avi|m4v)$/i)?.[0] || '.mp4';
}

function getCacheKey(url: string, kind: MediaKind): string {
  const hashStr = hashUrl(url);
  const ext = pickExtension(url, kind);
  return `${kind}_${hashStr}${ext}`;
}

/**
 * Sync check — returns local URI if already cached in memory, else undefined.
 */
export function getCachedMediaUri(url: string): string | undefined {
  if (!url) return undefined;
  return memoryCache.get(url);
}

/**
 * Sync check — boolean variant.
 */
export function isMediaCached(url: string): boolean {
  if (!url) return false;
  return memoryCache.has(url);
}

/**
 * Async check — returns true if URL is cached either in memory OR on disk.
 * Useful when re-mounting after app restart (memory map is empty).
 */
export async function isMediaCachedOnDisk(url: string, kind: MediaKind): Promise<boolean> {
  if (!url) return false;
  if (memoryCache.has(url)) return true;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  try {
    await ensureCacheDir();
    const localUri = MEDIA_CACHE_DIR + getCacheKey(url, kind);
    const info = await FileSystem.getInfoAsync(localUri);
    if (info.exists && info.size && info.size > 0) {
      memoryCache.set(url, localUri);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Tap-to-load entry point: returns the local URI for `url`, downloading on miss.
 *
 * - Local URIs (file://, content://, ph://) are returned as-is.
 * - Concurrent calls for the same URL share one download promise.
 * - On download failure, returns the original remote URL so the caller can
 *   surface a retry affordance without crashing.
 */
export async function getMediaUri(url: string, kind: MediaKind = 'image'): Promise<string> {
  if (!url) return url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return url;
  }

  const cached = memoryCache.get(url);
  if (cached) return cached;

  const inProgress = inProgressDownloads.get(url);
  if (inProgress) return inProgress;

  const downloadPromise = downloadAndCache(url, kind);
  inProgressDownloads.set(url, downloadPromise);

  try {
    return await downloadPromise;
  } finally {
    inProgressDownloads.delete(url);
  }
}

async function downloadAndCache(url: string, kind: MediaKind): Promise<string> {
  await ensureCacheDir();
  const cacheKey = getCacheKey(url, kind);
  const localUri = MEDIA_CACHE_DIR + cacheKey;

  try {
    const fileInfo = await FileSystem.getInfoAsync(localUri);
    if (fileInfo.exists && fileInfo.size && fileInfo.size > 0) {
      memoryCache.set(url, localUri);
      if (__DEV__) console.log('[MediaCache] hit (disk):', cacheKey);
      return localUri;
    }

    if (__DEV__) console.log('[MediaCache] downloading:', kind, url.substring(0, 60) + '…');

    const result = await FileSystem.downloadAsync(url, localUri);
    if (result.status === 200) {
      memoryCache.set(url, localUri);
      if (__DEV__) console.log('[MediaCache] cached:', cacheKey);
      return localUri;
    }

    console.warn('[MediaCache] download failed status', result.status);
    // Best effort cleanup of any partial file
    try {
      await FileSystem.deleteAsync(localUri, { idempotent: true });
    } catch {
      // ignore
    }
    return url;
  } catch (error) {
    console.warn('[MediaCache] error caching media:', error);
    try {
      await FileSystem.deleteAsync(localUri, { idempotent: true });
    } catch {
      // ignore
    }
    return url;
  }
}

/**
 * Delete a single cached media entry by remote URL (both memory + disk).
 * Required for secure-media once-view expiry: the cached file MUST be removed
 * once the backend marks the message expired so it can never be re-opened
 * from disk.
 */
export async function deleteCachedMedia(url: string, kind: MediaKind = 'image'): Promise<void> {
  if (!url) return;
  const localUri = memoryCache.get(url) || (MEDIA_CACHE_DIR + getCacheKey(url, kind));
  memoryCache.delete(url);
  inProgressDownloads.delete(url);
  try {
    await FileSystem.deleteAsync(localUri, { idempotent: true });
    if (__DEV__) console.log('[MediaCache] deleted:', localUri);
  } catch (error) {
    console.warn('[MediaCache] failed to delete cached media:', error);
  }
}

/**
 * Clear the entire media cache (debug / storage management).
 */
export async function clearMediaCache(): Promise<void> {
  try {
    await FileSystem.deleteAsync(MEDIA_CACHE_DIR, { idempotent: true });
    memoryCache.clear();
    inProgressDownloads.clear();
    isInitialized = false;
    if (__DEV__) console.log('[MediaCache] cleared');
  } catch (error) {
    console.warn('[MediaCache] error clearing cache:', error);
  }
}

/**
 * Stats helper for debugging.
 */
export async function getMediaCacheStats(): Promise<{
  memoryEntries: number;
  diskSizeBytes: number;
  fileCount: number;
}> {
  const memoryEntries = memoryCache.size;
  let diskSizeBytes = 0;
  let fileCount = 0;
  try {
    await ensureCacheDir();
    const files = await FileSystem.readDirectoryAsync(MEDIA_CACHE_DIR);
    fileCount = files.length;
    for (const file of files) {
      const info = await FileSystem.getInfoAsync(MEDIA_CACHE_DIR + file);
      if (info.exists && info.size) diskSizeBytes += info.size;
    }
  } catch {
    // ignore
  }
  return { memoryEntries, diskSizeBytes, fileCount };
}
