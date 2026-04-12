/**
 * videoCache.ts — Video caching and preloading service
 *
 * Provides:
 *   - Video caching to local file system (persistent across app restarts)
 *   - Preloading mechanism for visible videos in chat
 *   - In-memory tracking to avoid duplicate downloads
 *   - Cache hit returns instantly, no network fetch
 *
 * Usage:
 *   import { getVideoUri, preloadVideos } from '@/lib/videoCache';
 *
 *   // Get cached URI (or start caching if not cached)
 *   const localUri = await getVideoUri(remoteUrl);
 *
 *   // Preload multiple videos (non-blocking)
 *   preloadVideos([url1, url2, url3]);
 */

import * as FileSystem from 'expo-file-system';
import { Paths } from 'expo-file-system';

// Cache directory for videos - use new Paths API
const VIDEO_CACHE_DIR = `${Paths.cache.uri}video-cache/`;

// In-memory map: remoteUrl -> localUri (for instant cache hits)
const memoryCache = new Map<string, string>();

// In-progress downloads: remoteUrl -> Promise<localUri>
const inProgressDownloads = new Map<string, Promise<string>>();

// Track initialization state
let isInitialized = false;

/**
 * Initialize cache directory (called lazily on first use)
 */
async function ensureCacheDir(): Promise<void> {
  if (isInitialized) return;

  try {
    const dirInfo = await FileSystem.getInfoAsync(VIDEO_CACHE_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(VIDEO_CACHE_DIR, { intermediates: true });
    }
    isInitialized = true;
  } catch (error) {
    console.warn('[VideoCache] Failed to create cache directory:', error);
  }
}

/**
 * Generate a cache filename from URL (uses hash for uniqueness)
 */
function getCacheKey(url: string): string {
  // Simple hash function for URL -> filename
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  const hashStr = Math.abs(hash).toString(36);

  // Extract extension from URL or default to .mp4
  const urlPath = url.split('?')[0];
  const ext = urlPath.match(/\.(mp4|mov|webm|avi|m4v)$/i)?.[0] || '.mp4';

  return `video_${hashStr}${ext}`;
}

/**
 * Check if URL is already cached (sync check using memory cache)
 */
export function isCached(url: string): boolean {
  return memoryCache.has(url);
}

/**
 * Get cached URI synchronously (returns undefined if not cached)
 * Use this for instant cache hits without async overhead.
 */
export function getCachedUri(url: string): string | undefined {
  return memoryCache.get(url);
}

/**
 * Get cached URI for a video URL (async - will download if not cached)
 *
 * @param url Remote video URL
 * @returns Local file URI (from cache) or original URL if caching fails
 */
export async function getVideoUri(url: string): Promise<string> {
  // Skip non-http URLs (already local)
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return url;
  }

  // Check memory cache first (instant return)
  const cached = memoryCache.get(url);
  if (cached) {
    return cached;
  }

  // Check if download already in progress
  const inProgress = inProgressDownloads.get(url);
  if (inProgress) {
    return inProgress;
  }

  // Start download
  const downloadPromise = downloadAndCache(url);
  inProgressDownloads.set(url, downloadPromise);

  try {
    const localUri = await downloadPromise;
    return localUri;
  } finally {
    inProgressDownloads.delete(url);
  }
}

/**
 * Download video to cache and return local URI
 */
async function downloadAndCache(url: string): Promise<string> {
  await ensureCacheDir();

  const cacheKey = getCacheKey(url);
  const localUri = VIDEO_CACHE_DIR + cacheKey;

  try {
    // Check if file already exists on disk
    const fileInfo = await FileSystem.getInfoAsync(localUri);
    if (fileInfo.exists && fileInfo.size && fileInfo.size > 0) {
      // File exists and has content - add to memory cache and return
      memoryCache.set(url, localUri);
      if (__DEV__) console.log('[VideoCache] Cache hit (disk):', cacheKey);
      return localUri;
    }

    // Download the video
    if (__DEV__) console.log('[VideoCache] Downloading:', url.substring(0, 60) + '...');

    const downloadResult = await FileSystem.downloadAsync(url, localUri);

    if (downloadResult.status === 200) {
      // Success - add to memory cache
      memoryCache.set(url, localUri);
      if (__DEV__) console.log('[VideoCache] Cached:', cacheKey);
      return localUri;
    } else {
      // Download failed - return original URL
      console.warn('[VideoCache] Download failed:', downloadResult.status);
      return url;
    }
  } catch (error) {
    console.warn('[VideoCache] Error caching video:', error);
    return url; // Fallback to original URL
  }
}

/**
 * Preload multiple videos in parallel (non-blocking)
 *
 * @param urls Array of video URLs to preload
 * @param maxConcurrent Maximum concurrent downloads (default: 2)
 */
export function preloadVideos(urls: string[], maxConcurrent = 2): void {
  // Filter to only remote URLs that aren't already cached
  const toPreload = urls.filter(
    (url) =>
      (url.startsWith('http://') || url.startsWith('https://')) &&
      !memoryCache.has(url) &&
      !inProgressDownloads.has(url)
  );

  if (toPreload.length === 0) return;

  if (__DEV__) console.log('[VideoCache] Preloading', toPreload.length, 'videos');

  // Process in batches to limit concurrent downloads
  let index = 0;

  const processNext = async () => {
    while (index < toPreload.length) {
      const url = toPreload[index++];
      try {
        await getVideoUri(url);
      } catch {
        // Ignore errors during preload
      }
    }
  };

  // Start maxConcurrent workers
  for (let i = 0; i < Math.min(maxConcurrent, toPreload.length); i++) {
    processNext();
  }
}

/**
 * Clear all cached videos (for debugging or storage management)
 */
export async function clearVideoCache(): Promise<void> {
  try {
    await FileSystem.deleteAsync(VIDEO_CACHE_DIR, { idempotent: true });
    memoryCache.clear();
    isInitialized = false;
    if (__DEV__) console.log('[VideoCache] Cache cleared');
  } catch (error) {
    console.warn('[VideoCache] Error clearing cache:', error);
  }
}

/**
 * Get cache statistics (for debugging)
 */
export async function getCacheStats(): Promise<{
  memoryEntries: number;
  diskSizeBytes: number;
  fileCount: number;
}> {
  const memoryEntries = memoryCache.size;
  let diskSizeBytes = 0;
  let fileCount = 0;

  try {
    await ensureCacheDir();
    const files = await FileSystem.readDirectoryAsync(VIDEO_CACHE_DIR);
    fileCount = files.length;

    for (const file of files) {
      const info = await FileSystem.getInfoAsync(VIDEO_CACHE_DIR + file);
      if (info.exists && info.size) {
        diskSizeBytes += info.size;
      }
    }
  } catch {
    // Ignore errors
  }

  return { memoryEntries, diskSizeBytes, fileCount };
}
